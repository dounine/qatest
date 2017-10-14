
define('scenario/scenario_controller', ["jquery", "scenario/webview", "scenario/steps_list", "Element", "Action", "windows", "Scenario", "ScenarioResult", "bootstrap-notify", "q", "EventEmitter"], function ($, webview, stepsList, Element, Action, windows, Scenario, ScenarioResult, _bootstrap_notify, Q, EventEmitter) {
    "use strict";

    const webviewCoverBgRun = "rbga(0,0,0,0);";
    const webviewCoverBgEdit = "rbga(100,100,100,0.5)";

    const CHECK_RESULT_INTERVAL = 50;

    const WAIT_BEFORE_RUN_STEPS_SECONDS = 0;
    const WAIT_BEFORE_COMPLETE_ACTIONS = 100;

    const scenarioController = new EventEmitter();

    var device;
    var syncEngine;

    var webviewContainer;
    var webviewSelector;
    var webviewSelectorCancel;
    var pageStatus;

    var project;
    var baseScenario;
    var scenario;
    var saveCallback;

    var scenarioResult;
    var savingResult;
    var startUrl;

    var mode; // enum: edit, run
    var scenarioReady;

    var changedSinceLastSaved;

    var errorDeferred;

    /*
Return a promise that will be rejected once the page reach error state
*/
    var getError = function () {
        return errorDeferred.promise;
    };

    var setError = function (err) {
        console.log("Error on scenario: " + err);
        errorDeferred.reject(err);
    };

    var resetError = function () {
        errorDeferred = Q.defer();
    };
    resetError();

    var webviewCover = {
        get element() {
            this._element = this._element || $("#webview-cover");
            return this._element;
        },
        get canvas() {
            if (!this._canvas) {
                this._canvas = $("#webview-cover-canvas");
                this._canvas.get(0).width = this.element.width();
                this._canvas.get(0).height = this.element.height();
            }
            return this._canvas;
        },
        mask: function () {
            this.element.css("background-color", "rgba(100, 100, 100, 0.5)");
            return this;
        },
        unmask: function () {
            this.element.css("background-color", "");
            return this;
        },
        block: function (msg) {
            this.element.css("pointer-events", "auto");

            this.element.off(".webview");
            this.element.on("click.webview dblclick.webview mousedown.webview mouseup.webview keydown.webview keypress.webview keyup.webview", function (e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                console.log("cover stopped click/key");
                if (e.type === "mousedown" || e.type === "keypress") {
                    scenarioController.showMessage(msg);
                }
            });

            return this;
        },
        unblock: function () {
            this.element.css("pointer-events", "");
            this.element.off(".webview");
            return this;
        },
        highlightRect: function (rect) {
            var ctx = this.canvas.get(0).getContext("2d");
            ctx.strokeStyle = "#FF0000";
            ctx.lineWidth = 5;
            ctx.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
        },
        clearHighlight: function () {
            var ctx = this.canvas.get(0).getContext("2d");
            ctx.clearRect(0, 0, this.canvas.get(0).width, this.canvas.get(0).height);
        }
    };

    var actionsManager = function () {
        var my = {};

        /*
  Skip performing certain events because the previous event already triggered
  these event by Chrome:
  Note:

  1) Fire textInput event programmtically would change the value of text input
  and cause Chrome to fire an input event
  Solution: Skip input event following a input event

  2a) if form has submittable element
    real enter key
      - fire click event on submit element
      - always fire submit event on form
    fire enter key programmtically
      - does not fire any click or submit event
    real mouse click (on submittable element)
      - fire submit event
    fire click event programmtically
      - fire submit event
  Solution:
    Skip submit event if it is following a click event for the same form

  2b) if form does not have submittable element
    real enter key
      - fire submit event only if its the only text input element
      - does not fire submit event on non-text input element
    fire enter key programmtically
      - does not fire submit event
  Solution:
    No need to skip any events, Chrome does not fire anything, so eplay all event

  3) Enter space key on checkbox/radio
      - fire change event, then click events
      - fire space key programmtically does not fire change/click events
      - fire click event programmtically change input value and fire change event
    Solution: Ideally, we should skip the change event, and let the click event
              change the value and fire the change event, but since the change event
              often doesn't change any values, and to skip it we need to look ahead,
              so we just ignore it for now, so it will fire twice (one by programmatically
              before the click event, one by Chrome after the click)
*/

        var shouldSkip = function (currentAction, previousAction) {
            if (currentAction.type === "input" &&
                previousAction.type === "textInput" &&
                currentAction.element.equals(previousAction.element)) {
                return true;
            } else if (currentAction.type === "submit" &&
                previousAction.type === "click" &&
                previousAction.element.type === "submit" &&
                previousAction.element.formElement &&
                currentAction.element.equals(previousAction.element.formElement)) {
                return true;
            }

            return false;
        };

        var shouldBundle = function (originalAction, action) {
            if ((action.type === "mouseup" || action.type === "click") && action.element.equals(originalAction.element)) {
                return true;
            } else if (action.type === 'keyup') {
                return true;
            } else {
                return false;
            }
        };

        var _performActions = function (actions, results, index, currentActionCallback, completeCallback) {
            var actionsCount = 0, performingActions = [], resultsWithSkippedActions = [], actionsPromise;
            console.log("_performActions: actions:%O, results:%O, index:%i", actions, results, index);
            if (index >= actions.length) {
                setTimeout(function () {
                    webview.ready().then(function () {
                        completeCallback(null, results);
                    });
                }, WAIT_BEFORE_COMPLETE_ACTIONS);
                return;
            }

            currentActionCallback(index);

            if (actions[index].isComposable) {
                if (index !== 0 && shouldSkip(actions[index], actions[index - 1])) {
                    resultsWithSkippedActions[actionsCount] = ActionResult.create(true);
                } else {
                    performingActions.push(actions[index]);
                }
                for (actionsCount = 1; actionsCount < actions.length - index; actionsCount++) {
                    if (shouldSkip(actions[index + actionsCount], actions[index + actionsCount - 1])) {
                        resultsWithSkippedActions[actionsCount] = ActionResult.create(true);
                    } else if (shouldBundle(actions[index], actions[index + actionsCount])) {
                        performingActions.push(actions[index + actionsCount]);
                    } else {
                        break;
                    }
                }
                actionsPromise = EventData.perform(webview, performingActions);
            } else {
                actionsCount = 1;
                performingActions.push(actions[index]);
                actionsPromise = actions[index].perform(webview,
                    {dataResolve: dataResolver.resolve});
            }

            console.log("_performActions: performing: %O with promise %O", performingActions, actionsPromise);

            Promise.race([getError(), actionsPromise]).then(function (value) {
                console.log("Actions completed: %O", value);
                if (Array.isArray(value)) {
                    var i = 0;
                    value.forEach(function (r) {
                        while (resultsWithSkippedActions[i]) {
                            i++;
                        }
                        resultsWithSkippedActions[i] = r;
                    });
                } else {
                    resultsWithSkippedActions.push(value);
                }
                if (!resultsWithSkippedActions.every(function (r) {
                        return r;
                    })) {
                    console.error("resultsWithSkippedActions has undefined result: %O", resultsWithSkippedActions);
                }
                if (resultsWithSkippedActions.length !== actionsCount) {
                    console.error("resultsWithSkippedActions has different number of results then actions advanced");
                }

                var resultError;
                resultsWithSkippedActions.forEach(function (r) {
                    results.push(r);
                    if (!r.pass) {
                        resultError = r.error;
                    }
                });

                if (!resultError) {
                    webview.ready().then(function () {
                        _performActions(actions, results, index + actionsCount, currentActionCallback, completeCallback);
                    });
                } else {
                    completeCallback(resultError);
                }
                return;
            }, function (err) {
                console.log("Error occurred during performing action");
                completeCallback(err);
                return;
            });
        };

        my.performActions = function (scenario, result, callback) {
            var currentActionCallback = function (index) {
                stepsList.performingAction(scenario.actions[index]);
                saveResult();
            };

            _performActions(scenario.actions, result.actionResults, 0, currentActionCallback, function (runError) {
                if (runError) {
                    stepsList.errorOnPerformingStep(runError);
                } else {
                    stepsList.stepPerformCompleted();
                }

                callback(runError);
            });
        };

        return my;
    }();

    var stepsListComponent = (function () {
        var my = new EventEmitter();
        var listElement = $('#steps-list');

        my.redraw = function () {
            listElement.empty();
            stepsList.forEach(function (step, currentIndex) {
                listElement.append(createStepElement(currentIndex, step));
            });
        };

        var createStepElement = function (index, step) {
            var stepControls;

            var stepDiv = $("<div />", {'class': "step"});
            if (mode === "edit") {
                stepDiv.addClass("has-controls");

                var removeButton = $("<i />", {"class": "fa fa-border fa-minus-square", "title": "Remove Step"});
                removeButton.click(function () {
                    stepsList.removeStep(step);
                });
                if (step.editable()) {
                    var editButton = $("<i />", {"class": "fa fa-border fa-cog", "title": "Edit Step"});
                    editButton.click(function () {
                        scenarioController.emitEvent("editStep", [step]);
                    });
                    stepControls = $("<div />", {'class': "step-controls"}).append(
                        editButton, removeButton);
                } else {
                    stepControls = $("<div />", {'class': "step-controls"}).append(
                        removeButton);
                }

                stepDiv.append(stepControls);
            }

            stepDiv.append(
                $("<div />", {'class': "step-icon"}),
                $("<div />", {'class': "step-index"}).text(index + 1 + "."),
                $("<div />", {'class': "step-description"}).html(step.display())
            );
            stepDiv.mouseenter(function (event) {
                my.emitEvent("hoverInStep", [step]);
            });

            stepDiv.mouseleave(function (event) {
                my.emitEvent("hoverOutStep", [step]);
            });

            stepDiv.on("click", ".js-step-display-target", function (e) {
                e.preventDefault();
                my.emitEvent("clickElement", [step.element()]);
            });

            return stepDiv;
        };

        var getNthStepElement = function (nth) {
            var n = nth + 1;
            return listElement.find(".step:nth-child(" + n + ")");
        };

        var setStepState = function (nth, state) {
            var classes;

            listElement.find(".step-icon").removeClass("run fail");

            if (state) {
                switch (state) {
                    case 'run':
                        classes = "run";
                        break;
                    case 'fail':
                        classes = "fail";
                        break;
                }
                getNthStepElement(nth).find(".step-icon").addClass(classes);
            }
            else {
                listElement.find(".step-icon").removeClass("run fail");
            }
        };

        var setStepMessage = function (nth, message) {
            var stepMessage = $("<div />", {'class': "step-message"}).html(message);
            getNthStepElement(nth).after(stepMessage);
        };

        stepsList.addListener("change", function () {
            my.redraw();
        });

        stepsList.addListener("stepPlaying", function (stepIndex) {
            setStepState(stepIndex, "run");
        });

        stepsList.addListener("stepError", function (stepError) {
            setStepState(stepError.stepIndex, "fail");
            setStepMessage(stepError.stepIndex, stepError.errorMessage);
        });

        stepsList.addListener("stepCompleted", function () {
            setStepState(null, null);
        });

        return my;
    })();

    stepsListComponent.addListener("hoverInStep", function (step) {
        if (step.element()) {
            highlightElement(step.element());
        }
    });

    stepsListComponent.addListener("hoverOutStep", function (step) {
        clearHighlight();
    });

    stepsListComponent.addListener("clickElement", function (element) {
        if (element) {
            clearHighlight();
            webview.scrollToElement(element, function (success) {
                if (success) {
                    highlightElement(element);
                } else {
                    console.log("Unable to scroll to element");
                    scenarioController.showMessage("Element not found on page");
                }
            });
        }
    });

    stepsList.addListener("removeStep", function (fn) {
        scenario.actions = fn(scenario.actions);
        clearHighlight();
        stepsList.reset(scenario.actions);
    });


    const dataResolver = (function () {
        const my = {};
        var projectResolved = {};
        var scenarioResolved = {};

        function dataEquals(data1, data2) {
            return data1.name === data2.name &&
                data1.value === data2.value &&
                data1.regex === data2.regex;
        }

        my.resolve = function (origin, name) {
            let resolved, dataSet;
            if (origin === "project") {
                resolved = projectResolved;
                dataSet = project.dataSet;
            } else {
                resolved = scenarioResolved;
                dataSet = scenario.dataSet;
            }

            try {
                return _resolve(dataSet, resolved, name, []);
            } catch (err) {
                if (typeof err === "string") {
                    throw err + ". Data \"" + name + "\" can not be resolved.";
                } else {
                    console.error("Error during data resolution: %O", err);
                    throw "Data resolution error";
                }
            }
        };

        function _resolve(dataSet, resolved, dataName, used) {
            let data = dataSet.getData(dataName);
            if (!data) {
                throw "Data \"" + dataName + "\" is missing";
            }

            // if resolved, and data has not been changed since resolved
            if (resolved[dataName] && dataEquals(resolved[dataName].data, data)) {
                return resolved[dataName].resolution;
            }

            // Check circular reference after checking if it is resolved, because
            // data might be referenced multiple times without cicular reference. If
            // if it is resolved it doesn't reach this point. It is only a cicular
            // reference only if it is used but not resolved.
            if (used.indexOf(dataName) >= 0) {
                throw "Data \"" + dataName + "\" is used in circular reference";
            }
            // Add to used before start resolving, because immediate children might
            // reference this data and cause a circulr reference.
            used.push(dataName);

            let originalString = data.value;
            if (!data.regex) {
                // If not regex, resolve as is
                resolved[dataName] = {
                    data: data,
                    resolution: originalString
                };
            } else {

                let matches = [];
                let regex = /(?:[^\\]|^)(?:\\\\)*(\$\{(\w+)\})/g;
                let m;
                // First get all matches, must use exec and change lastIndex, otherwise
                // can not capture overlapping matches (matching at least 1 char before ${)
                while (m = regex.exec(originalString)) {
                    matches.push(m);
                    regex.lastIndex = m.index + 1;
                }

                let result = "";
                let lastIndex = 0;
                // Resolve each match while building the result string
                // resolved valu may have different length than the ${data} length
                matches.forEach(function (match) {
                    let subName = match[2];
                    let subResolve = _resolve(dataSet, resolved, subName, used);

                    let subStartIndex = match[0].indexOf("${"); // get where ${ in the match
                    let startIndex = match.index + subStartIndex; // get where ${ in the whole string
                    let subEndIndex = match[0].lastIndexOf("}"); // get where } in the match
                    let endIndex = match.index + subEndIndex + 1; // get where } in the whole string, plus one to include it

                    // build up to where ${ start
                    result = result + originalString.substring(lastIndex, startIndex);
                    // add the resolved value, escape as plain string
                    result = result + (data.regex ? subResolve.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&") : subResolve);
                    // save where last ended
                    lastIndex = endIndex;
                });

                if (lastIndex < originalString.length) {
                    // add the rest of string after the last resolved data
                    result = result + originalString.substring(lastIndex, originalString.length);
                }

                resolved[dataName] = {
                    data: data,
                    resolution: new RandExp(result).gen()
                };
            }
            return resolved[dataName].resolution;
        }

        my.empty = function () {
            projectResolved = {};
            scenarioResolved = {};
        };

        return my;
    })();

    webview.addListener("eventData", function (action) {
        if (mode === 'edit') {
            handleNewAction(action);
        }
    });

    webview.addListener("initializeStop", function () {
        console.log("initializeStop");
        hidePageLoading();

        if (scenarioReady) {
            webviewCover.unblock().unmask();
        }
    });

    webview.addListener("initializeStart", function () {
        console.log("开始加载");
        if (!getError().isRejected()) { // sometimes loadstart is fired (and therefore initializestart) after error
            showPageLoading();
            webviewCover.block("请等待页面加载完毕.").mask();
        }
    });

    webview.addListener("halt", function (msg) {
        setError(msg);
    });

    webview.addListener("urlChanged", function (url) {
        $("#scenario-url").text(url);
    });

    var initialize = function (se, de, url, base) {
        syncEngine = se;
        device = de;

        baseScenario = base;
        scenario = baseScenario.clone();
        startUrl = url;
        webviewContainer = $("#webview-container");
        pageStatus = $("#page-status");
        webviewCover.block("请等待页面加载完毕.").mask();
        syncEngine.getProjectByScenario(baseScenario).then(function (p) {
            if (p) {
                project = p;
            }
            if (project) {
                syncEngine.on("projectUpdated", function (p) {
                    project = p;
                });
            }
        });
    };

    scenarioController.initializeForEdit = function (se, de, url, base, saveCb) {
        initialize(se, de, url, base);
        saveCallback = saveCb;

        scenarioResult = ScenarioResult.createWithJson();

        mode = 'edit';
        savingResult = false;

        changedSinceLastSaved = false;

        webviewSelector = $(".webview-selector");
        webviewSelectorCancel = $(".webview-selector-cancel");
    };

    scenarioController.initializeForRun = function (se, de, url, base, baseRes, saving) {
        initialize(se, de, url, base);
        scenarioResult = baseRes;
        savingResult = saving;
        mode = 'run';
    };

    scenarioController.revertToLastSaved = function () {
        scenario = baseScenario.clone();
        changedSinceLastSaved = false;
    };

    scenarioController.clearAllSteps = function () {
        scenario.actions = [];
        changedSinceLastSaved = true;
    };

    scenarioController.stepUpdated = function () {
        changedSinceLastSaved = true;
        stepsList.reset(scenario.actions);
    };

    scenarioController.updateAction = function (action, fn) {
        let foundIndex = scenario.actions.indexOf(action);
        if (foundIndex >= 0) {
            scenario.actions[foundIndex] = fn(action);
            changedSinceLastSaved = true;
            stepsList.reset(scenario.actions);
        } else {
            console.error("Requested to update non-existed action: %O", action);
        }
    };

    /*
cb(err) - callback when reset is completed
        - err - error if any
*/
    scenarioController.reset = function (cb) {
        resetError();
        dataResolver.empty();

        scenarioResult.reset();
        saveResult();

        stepsList.reset(scenario.actions);
        scenarioReady = false;

        initializeWebView();

        Promise.race([getError(), webview.ready()]).then(function () {
            console.log("------------------ Webview is ready. Begin running steps. ------------------");
            scenarioController.rerun(function (err) {
                console.log("------------------ Run steps completed. ------------------");
                webviewCover.unmask().unblock();
                hidePageLoading();
                scenarioReady = true;
                cb(err);
            });
        }, function (err) {
            console.log("Page reached error state before running steps: %O", err);

            scenarioResult.actions = [];
            scenarioResult.actionResults = [];
            scenarioResult.fail();
            saveResult();

            webviewCover.unmask().unblock();
            hidePageLoading();
            scenarioReady = true;
            cb(err);
        });
    };

    scenarioController.rerun = function (cb) {
        scenarioResult.startTime = new Date();

        setTimeout(function () {
            scenarioResult.actions = scenario.actions;
            actionsManager.performActions(scenario, scenarioResult, function (error) {
                if (error) {
                    scenarioResult.fail();
                } else {
                    scenarioResult.pass();
                }
                saveResult();

                cb(error);
            });
        }, WAIT_BEFORE_RUN_STEPS_SECONDS * 1000);
    };

    scenarioController.createRunScenario = function () {
        return scenario.clone();
    };

    scenarioController.addBackStep = function () {
        scenarioController.addAction(BrowserAction.create("back"));
        webview.back();
    };

    scenarioController.addForwardStep = function () {
        scenarioController.addAction(BrowserAction.create("forward"));
        webview.forward();
    };

    scenarioController.addReloadStep = function () {
        scenarioController.addAction(BrowserAction.create("reload"));
        webview.reload();
    };

    scenarioController.captureSelection = function (cb) {
        webviewSelector.show();
        webviewContainer.addClass("webview-selector-container");

        var left = webviewContainer.offset().left + (webviewContainer.outerWidth() - $(".webview-selector-info").outerWidth()) / 2;
        $(".webview-selector-info").offset({left: left});

        var highlightHoveringElement = function (bounds) {
            webviewCover.clearHighlight();
            webviewCover.highlightRect(bounds);
        };
        webview.addListener("hover", highlightHoveringElement);

        webview.startCaptureSelection(function (element) {
            console.log("selected element " + (Boolean(element) ? element.toString() : 'none'));
            webviewSelector.hide();
            webviewContainer.removeClass("webview-selector-container");
            cb(element);

            // Capture one selection at a time
            webview.stopCaptureSelection();
            webview.off("hover", highlightHoveringElement);
            webviewCover.clearHighlight();
        });

        webviewSelectorCancel.one('click', function (e) {
            webview.stopCaptureSelection();
            webview.off("hover", highlightHoveringElement);
            webviewCover.clearHighlight();

            webviewSelector.hide();
            webviewContainer.removeClass("webview-selector-container");
            cb(null);
        });
    };

    scenarioController.saveScenario = function () {
        return saveCallback(scenario).then(function (s) {
                baseScenario = s;
                changedSinceLastSaved = false;
                scenarioController.showMessage("Scenario saved");
            }
        ).catch(function (err) {
            console.error("Error saving scenario: %O", err);
            scenarioController.showMessage("Saving scenario failed");
            return Promise.reject(err);
        });

    };

    scenarioController.hasUnsavedChanges = function () {
        return changedSinceLastSaved;
    };

    scenarioController.getCurrentUrl = function () {
        return webview.getCurrentUrl();
    };

    scenarioController.getDataSets = function () {
        if (project) {
            return {
                project: project.dataSet,
                scenario: scenario.dataSet
            };
        } else {
            return {
                scenario: scenario.dataSet
            };
        }
    };

    scenarioController.updateScenarioDataSet = function (dataSet) {
        scenario.dataSet = dataSet;
        changedSinceLastSaved = true;
    };

    scenarioController.insertString = function (element, string) {
        return webview.insertString(element, string);
    };

    var highlightElement = function (element) {
        console.log("highlight " + element.toString());
        webview.getElementCoordinates(element, function (rect) {
            if (rect) {
                webviewCover.highlightRect(rect);
            }
        });
    };

    var clearHighlight = function () {
        console.log("clear highlight");
        webviewCover.clearHighlight();
    };

    var handleNewAction = function (action) {
        if (mode === "edit" && scenarioReady) {
            console.log("got new action: %O", action);
            scenarioController.addAction(action);
        }
    };

    var initializeWebView = function () {
        webview.create({
            width: device.getWidth(scenario.deviceSize),
            height: windows.calculateWebviewHeight(),
            userAgent: device.getUserAgent(scenario.deviceSize)
        });
        webview.appendTo(webviewContainer);

        $("#scenario-url").text(startUrl);
        webview.navigate(startUrl);
    };

    var saveResult = function () {
        if (savingResult) {
            console.log("Saving Result: %O", scenarioResult);
            scenarioResult.save(syncEngine);
        }
    };

    scenarioController.showMessage = function (msg) {
        $.notify({
            icon: "fa fa-warning",
            message: ' ' + msg
        }, {
            type: "growl",
            allow_dismiss: false,
            placement: {
                from: "top",
                align: "right"
            },
            mouse_over: "pause",
            animate: {
                enter: 'animated fadeInDown',
                exit: 'animated fadeOutUp'
            },
            template: '<div data-notify="container" class="alert alert-{0}" role="alert">' +
            '<button type="button" aria-hidden="true" class="close" data-notify="dismiss">×</button>' +
            '<span data-notify="icon"></span> ' +
            '<span data-notify="title">{1}</span> ' +
            '<span data-notify="message">{2}</span>' +
            '<div class="progress" data-notify="progressbar">' +
            '<div class="progress-bar progress-bar-{0}" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>' +
            '</div>' +
            '<a href="{3}" target="{4}" data-notify="url"></a>' +
            '</div>'
        });
    };

    var showPageLoading = function () {
        pageStatus.show();
    };

    var hidePageLoading = function () {
        pageStatus.hide();
    };

    scenarioController.addAction = function (action, options) {
        options = options || {};

        scenario.actions.push(action);
        changedSinceLastSaved = true;

        if (options.perform) {
            action.perform(webview,
                {dataResolve: dataResolver.resolve});
        }
        stepsList.reset(scenario.actions);
    };

    return scenarioController;
});