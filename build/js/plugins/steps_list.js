define('scenario/steps_list', ["jquery", "underscore", "Element", "Action", "scenario/keycode", "EventEmitter"], function ($, _, Element, Action, keyCode, EventEmitter) {
    "use strict";

    const stepsList = new EventEmitter();

    var steps = [];

    var performingStepIndex;

    var isKeyEvent = function (e) {
        return _.contains(["keydown", "keypress", "keyup"], e.type);
    };

    var isMouseEvent = function (e) {
        return _.contains(["mousedown", "mouseup", "click"], e.type);
    };

    var lastKeyEvent = function (step) {
        for (var i = step.events.length - 1; i >= 0; i--) {
            if (isKeyEvent(step.events[i])) {
                return step.events[i];
            }
        }
        return null;
    };

    stepsList.performingAction = function (action) {
        stepsList.forEach(function (step, stepIndex) {
            if (step.hasAction(action)) {
                performingStepIndex = stepIndex;
                stepsList.emitEvent("stepPlaying", [stepIndex]);
            }
        });
    };

    stepsList.errorOnPerformingStep = function (error) {
        stepsList.emitEvent("stepError", [{
            stepIndex: performingStepIndex,
            errorMessage: error
        }]);
    };

    stepsList.stepPerformCompleted = function () {
        stepsList.emitEvent("stepCompleted");
    };

    stepsList.reset = function (actions) {
        steps = [];

        var currentMouseStep = null;
        var currentInputStep = null;
        // var keySteps = [];
        var currentKeyStep = null;
        var currentSubmitStep = null;
        var currentTabStep = null;
        actions.forEach(function (action, actionIndex) {
            if (action.isComposable) {
                if (isKeyEvent(action) && action.options.keyCode === 9 /* TabStep */) {
                    currentMouseStep = null;
                    currentKeyStep = null;
                    if (action.type === "keydown") {
                        currentTabStep = TabStep.create();
                        currentTabStep.addAction(action);
                        steps.push(currentTabStep);
                    } else {
                        if (action.type === "keyup") {
                            if (currentTabStep) {
                                currentTabStep.addAction(action);
                            } else {
                                console.log("Orphan tab event: %O", action);
                            }
                        } else {
                            console.error("Unknown event type for TabStep: " + action.type);
                        }
                    }
                } else if (isKeyEvent(action) /* KeyStep */) {
                    currentMouseStep = null;
                    if (currentKeyStep && currentKeyStep.element().equals(action.element)) {
                        // Add event to current Key Step
                        currentKeyStep.addAction(action);
                    } else {
                        currentKeyStep = KeyStep.create();
                        currentKeyStep.addAction(action);
                        steps.push(currentKeyStep);
                    }
                } else if (isMouseEvent(action) /* MouseStep */) {
                    if (action.type === "click" &&
                        action.element.tagName === "input" &&
                        action.element.type === "submit" &&
                        currentKeyStep &&
                        _.contains([13, 32], lastKeyEvent(currentKeyStep).options.keyCode) &&
                        lastKeyEvent(currentKeyStep).element.formElement.equals(action.element.formElement)) {
                        /*
          Special condition where the click event is generated by pressing a enter
          or space key on some input elements, eg. checkbox, submittable elements
          Include it in the KeyStep of the space/enter key
        */
                        if (currentKeyStep) {
                            currentKeyStep.addAction(action);
                        } else {
                            console.error("Orphan click event: %O", action);
                        }
                    } else {
                        currentKeyStep = null;
                        if (currentMouseStep && currentMouseStep.element().equals(action.element) &&
                            action.type !== "mousedown") {
                            currentMouseStep.addAction(action);
                        } else {
                            currentMouseStep = MouseStep.create();
                            currentMouseStep.addAction(action);
                            steps.push(currentMouseStep);
                        }
                    }
                } else if (_.contains(['input', 'change', 'submit', 'textInput'], action.type)) {
                    var added = false;
                    for (var i = steps.length - 1; i >= 0 && !added; i--) {
                        if (MouseStep.isPrototypeOf(steps[i]) || KeyStep.isPrototypeOf(steps[i])) {
                            added = true;
                            steps[i].addAction(action);
                        }
                    }
                    if (!added) {
                        console.log("Orphan %s event: %O", action.type, action);
                    }
                }
            } else {
                steps.push(SingleActionStep.create(action));
            }
        });

        let addedEvents = steps.reduce(function (sum, s) {
            return s.events.length + sum;
        }, 0);
        if (addedEvents !== actions.length) {
            console.error("Not all events " + actions.length + " added to steps " + addedEvents);
        }

        stepsList.emitEvent("change");
    };

    stepsList.removeStep = function (step) {
        stepsList.emitEvent("removeStep", [function (actions) {
            return actions.filter(function (a) {
                return !step.hasAction(a);
            });
        }]);
    };

    stepsList.forEach = function (fn) {
        steps.forEach(fn);
    };

    const Step = {
        addAction: function (evt) {
            this.events = this.events || [];
            this.events.push(evt);
        },
        hasAction: function (evt) {
            return (this.events || []).indexOf(evt) > -1;
        },
        create: function () {
            return Object.create(this);
        },
        element: function () {
            return (this.events || [])[0].element;
        },
        editElement: function (fn) {
            (this.events || []).forEach(function (action) {
                if (action.element) {
                    fn(action.element);
                }
            });
        },
        editable: function () {
            return true;
        }
    };

    const MouseStep = Object.create(Step, {
        type: {
            get: function () {
                return "MouseStep";
            }
        },
        display: {
            value: function () {
                var a = "";
                if (_.find(this.events, function (e) {
                        return e.type === "click";
                    })) {
                    a = "Click";
                } else if (_.find(this.events, function (e) {
                        return e.type === "mousedown";
                    })) {
                    if (_.find(this.events, function (e) {
                            return e.type === "mouseup";
                        })) {
                        a = "Mouse down and up";
                    } else {
                        a = "Mouse down";
                    }
                } else {
                    a = "Mouse up";
                }
                return Displayable.displayAction(a) + " on " +
                    Displayable.displayTarget(this.element().toString());
            }
        },
        editElement: {
            value: function (fn) {
                (this.events || []).forEach(function (action, actionIndex) {
                    if (action.element && action.type !== "submit") {
                        fn(action.element);
                    } else if (action.type === "submit") {
                        var ele = this.events[actionIndex - 1].element.getDOMElement();
                        if (ele && ele.form) {
                            action.element = Element.createWithDOMElement(ele.form);
                        }
                    }
                });
            }
        }
    });

    const KeyStep = Object.create(Step, {
        type: {
            get: function () {
                return "KeyStep";
            }
        },
        display: {
            value: function () {
                var keys = [];
                var filtered = this.events.filter(function (e) {
                    return e.type === "keydown" || e.type === "keypress";
                });
                var lastKeyDown = null, lastKeyPress = null;
                for (var i = 0; i < filtered.length; i++) {
                    if (filtered[i].type === "keydown") {
                        if (lastKeyDown) {
                            keys.push(lastKeyDown);
                        }
                        lastKeyDown = filtered[i];
                    } else {
                        if (lastKeyDown) {
                            if (keyCode.matchCharCodeToKeyCode(filtered[i].options.charCode, lastKeyDown.options.keyCode)) {
                                lastKeyDown = null;
                                keys.push(filtered[i]);
                            } else {
                                keys.push(lastKeyDown);
                                console.error("Orphan keypress: %O, lastKeyDown: %O", filtered[i], lastKeyDown);
                                lastKeyDown = null;
                            }
                        } else {
                            console.error("Orphan keypress: %O", filtered[i]);
                        }
                    }
                }
                if (lastKeyDown) {
                    keys.push(lastKeyDown);
                }
                var keysStr = keys.map(function (k) {
                    if (k.type === "keydown") {
                        if (keyCode.isModifierKey(k.options.keyCode)) {
                            return keyCode.keyCodeToString(k.options.keyCode);
                        } else {
                            var str = keyCode.keyCodeToString(k.options.keyCode);
                            if (k.options.ctrlKey) {
                                str = "Ctrl-" + str;
                            }
                            if (k.options.metaKey) {
                                str = "Cmd-" + str;
                            }
                            if (k.options.altKey) {
                                str = "Alt-" + str;
                            }
                            if (k.options.shiftKey) {
                                str = "Shift-" + str;
                            }
                            return str;
                        }
                    } else {
                        return keyCode.charCodeToString(k.options.charCode);
                    }
                });

                return Displayable.displayAction("Type") +
                    " [" +
                    keysStr.map(function (k) {
                        return "<span>" + k + "</span>";
                    }).join(', ') +
                    "]" +
                    " on " +
                    Displayable.displayTarget(this.element().toString());
            }
        },
        editElement: {
            value: function (fn) {
                (this.events || []).forEach(function (action, actionIndex) {
                    if (action.element && action.type !== "submit") {
                        fn(action.element);
                    } else if (action.type === "submit") {
                        var ele = this.events[actionIndex - 1].element.getDOMElement();
                        if (ele && ele.form) {
                            action.element = Element.createWithDOMElement(ele.form);
                        }
                    }
                });
            }
        }
    });

    const TabStep = Object.create(Step, {
        type: {
            get: function () {
                return "TabStep";
            }
        },
        display: {
            value: function () {
                var ku;
                if (ku = _.find(this.events, function (e) {
                        return e.type === "keyup";
                    })) {
                    return Displayable.displayAction("Use [Tab]") + " to focus on " +
                        Displayable.displayTarget(ku.element.toString());
                } else {
                    return Displayable.displayAction("Use [Tab]") + " on " +
                        Displayable.displayTarget(this.events[0].element.toString());
                }
            }
        },
        element: {
            value: function () {
                var ku;
                if (ku = _.find(this.events, function (e) {
                        return e.type === "keyup";
                    })) {
                    return ku.element;
                } else {
                    return this.events[0].element;
                }
            }
        },
        addAction: {
            value: function (eventData) {
                if (eventData.type !== "keyup" && eventData.type !== "keydown") {
                    throw new Error("Unknown event type for TabStep: " + eventData.type);
                }
                if (eventData.options.keyCode !== 9) {
                    throw new Error("TabStep only accept keyCode 9");
                }
                this.events = this.events || [];
                this.events.push(eventData);
            }
        },
        editElement: {
            value: function (fn) {
                if (ku = _.find(this.events, function (e) {
                        return e.type === "keyup";
                    })) {
                    fn(ku.element);
                } else {
                    fn(this.events[0].element);
                }
            }
        }
    });


    const SingleActionStep = Object.create(Step, {
        type: {
            get: function () {
                return "SingleActionStep";
            }
        },
        create: {
            value: function (action) {
                var step = Object.create(SingleActionStep);
                step.events = [action];
                return step;
            }
        },
        display: {
            value: function () {
                return this.events[0].display();
            }
        },
        action: {
            get: function () {
                return this.events[0];
            },
            set: function (a) {
                this.events[0] = a;
            }
        },
        editable: {
            value: function () {
                return !this.action.is(BrowserAction);
                // return this.action.__objectType === "WaitTimeAction" ||
                //   this.action.__objectType === "VerifyUrlAction" ||
                //   this.action.__objectType === "VerifyTextAction" ||
                //   this.action.__objectType === "DataInsertAction";
            }
        }
    });

    return stepsList;
});
