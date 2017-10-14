requirejs(["jquery", "bootstrap", "scenario/scenario_controller", "ScenarioResult", "Element", "windows", "utils", "bootstro", "q", "DataSet"], function ($, _b, scenarioController, ScenarioResult, Element, windows, utils, bootstro, Q, DataSet) {
    'use strict';

    $(function () {

        const bootstroOptions = {
            nextButton: '<button class="btn btn-primary btn-mini bootstro-next-btn">下一步 <i class="fa fa-angle-double-right"></i></button>',
            prevButton: '<button class="btn btn-primary btn-mini bootstro-prev-btn"><i class="fa fa-angle-double-left"></i> 上一步</button>',
            finishButtonText: "跳过教程"
        };

        var device;

        $(function () {
            chrome.runtime.getBackgroundPage(function (bg) {
                device = bg.device;
                $(".js-scenario-device-size").append(device.getLabel(baseScenario.deviceSize));

                scenarioController.initializeForEdit(bg.syncEngine, device, startUrl, baseScenario, bg.syncEngine.addScenario);

                scenarioController.reset(function (err) {
                    if (err) {
                        scenarioController.showMessage("设置网页时出错.");
                    } else {
                        scenarioController.showMessage("你的页面已经准备.");
                    }
                });

                if (!window.shownTutorial) {
                    bootstro.start(".bootstro", bootstroOptions);
                }

                $(".js-link-doc").click(function (e) {
                    // $(window).on("click", ".js-link-doc", function(e) {
                    e.preventDefault();
                    var url = bg.remoteHost + "/documentation/" + $(this).data("doc-section");
                    var sub = $(this).data("doc-subsection");
                    if (sub) {
                        url = url + "#" + sub;
                    }
                    window.open(url);
                });
            });

            $("#scenario-name").text(baseScenario.name);

            $(".modal-hints").on("click", function (e) {
                e.preventDefault();
                $($(this).data("target")).toggle();
            });

            const resetComponent = (function () {
                const resetButton = $("#reset-btn");
                const resetModal = $("#reset-modal");
                const resetForm = $("#reset-form");
                const optionLastSaved = $("#reset-options-last-saved");
                const optionClear = $("#reset-options-clear");
                const optionRerun = $("#reset-options-rerun");

                resetForm.submit(function (e) {
                    e.preventDefault();

                    resetModal.modal('hide');
                    if (optionClear.is(":checked")) {
                        scenarioController.clearAllSteps();
                    } else if (optionLastSaved.is(":checked")) {
                        scenarioController.revertToLastSaved();
                    }

                    console.log("-------------- Reset is requested ---------------");
                    scenarioController.reset(function (err) {
                        if (err) {
                            scenarioController.showMessage("Error setting up your webpage.");
                        } else {
                            scenarioController.showMessage("Your webpage is ready.");
                        }
                    });
                });

                resetModal.on("show.bs.modal", function (e) {
                    optionRerun.prop("checked", true);
                });
            })();

            var runButton = document.querySelector('#test-run-btn');
            runButton.addEventListener("click", function () {
                var testrunScenario = scenarioController.createRunScenario();
                delete testrunScenario.key;
                windows.openScenarioWindowForRun(device, testrunScenario,
                    {
                        hidden: false
                    },
                    function (createdWindow) {
                        createdWindow.contentWindow.baseScenario = testrunScenario;
                        createdWindow.contentWindow.baseScenarioResult = ScenarioResult.createWithJson();
                        createdWindow.contentWindow.startUrl = startUrl;
                        createdWindow.contentWindow.savingResult = false;
                        createdWindow.contentWindow.hideForWindowClose = false;
                    });
            });

            var saveButton = document.querySelector('#save-btn');
            saveButton.addEventListener("click", function () {
                scenarioController.saveScenario();
            });

            const VerifyTextComponent = (function () {
                const verifyTextButton = $("#verify-text-btn");
                const verifyTextForm = $("#verify-text-form");
                const verifyTextInput = $("#verify-text-input");
                const caseSensitiveCheckbox = $("#verify-text-case-insensitive");
                const notExistCheckbox = $("#verify-text-not-exist");
                const elementsSelectionTitle = $("#verify-text-elements-selection-title");
                const elementAnywhereRadio = $("#verify-text-element-anywhere");
                const elementSelectRadio = $("#verify-text-element-select");
                const selectedElementDiv = $("#verify-text-selected-element");
                const elementSelectAnother = $("#verify-text-element-select-another");
                const verifyTextModal = $("#verify-text-modal");
                const verifyTextError = $("#verify-text-error");

                const my = {};
                let editVerifyTextDeferred;
                let selectedElement = null;

                my.editVerifyText = function (action) {
                    verifyTextInput.val(action.text);
                    caseSensitiveCheckbox.prop("checked", action.insensitive);
                    notExistCheckbox.prop("checked", action.not);
                    setElementsSelectionTitle();
                    setSelectedElement(action.element);
                    verifyTextError.html('');

                    editVerifyTextDeferred = Q.defer();
                    editVerifyTextDeferred.promise.finally(function () {
                        verifyTextModal.modal("hide");
                    });
                    verifyTextModal.modal("show");
                    return editVerifyTextDeferred.promise;
                };

                verifyTextButton.click(function () {
                    my.editVerifyText(VerifyTextAction.create(null, "", false, false))
                        .then(function (action) {
                            scenarioController.addAction(action);
                        });
                });

                function getSelectedElement() {
                    return selectedElement;
                }

                function setSelectedElement(element) {
                    if (element) {
                        selectedElement = element;
                        elementSelectRadio.prop("checked", true);
                        selectedElementDiv.html(selectedElement.toString());
                        elementSelectAnother.show();
                    } else {
                        // User didn't choose any element
                        if (getSelectedElement() === null) {
                            // There weren't any element selected before
                            // set it back to default
                            elementAnywhereRadio.prop("checked", true);
                            selectedElementDiv.text("<none>");
                        }
                    }
                }

                elementSelectRadio.change(function (e) {
                    e.preventDefault();

                    if ($(this).is(":checked") && !getSelectedElement()) {
                        // if choosing to select a element for the first time
                        scenarioController.captureSelection(function (element) {
                            setSelectedElement(element);
                        });
                    }
                });

                elementSelectAnother.click(function (e) {
                    e.preventDefault();

                    scenarioController.captureSelection(function (element) {
                        setSelectedElement(element);
                    });
                });

                verifyTextForm.submit(function (e) {
                    e.stopPropagation();
                    e.preventDefault();

                    let searchString;

                    if ((searchString = verifyTextInput.val()) !== '') {
                        let element = null; // null mean anywhere
                        if (elementSelectRadio.is(":checked")) {
                            element = getSelectedElement();
                        }
                        editVerifyTextDeferred.resolve(
                            VerifyTextAction.create(element,
                                searchString,
                                caseSensitiveCheckbox.is(":checked"),
                                notExistCheckbox.is(":checked")));
                    } else {
                        verifyTextError.text("Text for verification required.");
                    }
                });

                notExistCheckbox.change(function (e) {
                    e.preventDefault();
                    setElementsSelectionTitle();
                });

                var setElementsSelectionTitle = function () {
                    if (notExistCheckbox.is(":checked")) {
                        elementsSelectionTitle.text("The text should not appear:");
                    } else {
                        elementsSelectionTitle.text("The text should appear:");
                    }
                };

                function reset() {
                    verifyTextInput.val('');
                    caseSensitiveCheckbox.prop("checked", false);
                    notExistCheckbox.prop("checked", false);
                    setElementsSelectionTitle();
                    elementAnywhereRadio.prop("checked", true);
                    selectedElementDiv.text("<none>");
                    selectedElement = null;
                    elementSelectAnother.hide();
                    verifyTextError.html('');
                }

                verifyTextModal.on("show.bs.modal", function () {
                    verifyTextInput.focus();
                    elementSelectAnother.hide();
                    verifyTextError.html('');
                });

                verifyTextModal.on("hidden.bs.modal", reset);

                return my;
            })();

            const waitTimeComponent = (function () {
                const waitTimeButton = $("#wait-time-btn");
                const waitTimeForm = $("#wait-time-form");
                const waitTimeSelect = $("#wait-time-select");
                const waitTimeModal = $("#wait-time-modal");
                const my = {};

                let editStepDeferred = null;

                my.editWaitTime = function (waitTimeAction) {
                    waitTimeSelect.val(waitTimeAction.seconds);
                    editStepDeferred = Q.defer();
                    editStepDeferred.promise.finally(function () {
                        waitTimeModal.modal("hide");
                    });
                    waitTimeModal.modal("show");
                    return editStepDeferred.promise;
                };

                waitTimeButton.click(function () {
                    my.editWaitTime(WaitTimeAction.create())
                        .then(function (action) {
                            scenarioController.addAction(action);
                        });
                });

                waitTimeForm.submit(function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    editStepDeferred.resolve(WaitTimeAction.create(parseInt(waitTimeSelect.val(), 10)));
                });

                function reset() {
                    waitTimeSelect.children().first().prop("selected", true);
                }

                waitTimeModal.on("hidden.bs.modal", reset);

                return my;
            })();

            const closeComponent = (function () {
                let closeBtn = $(".js-close");
                let closeForm = $("#close-form");
                let closeModal = $("#close-modal");
                let closeWithoutSaveBtn = $("#close-not-save-btn");

                closeForm.submit(function () {
                    scenarioController.saveScenario().then(function () {
                        chrome.app.window.current().close();
                    });
                });
                closeWithoutSaveBtn.click(function () {
                    chrome.app.window.current().close();
                });
                closeBtn.on("click", function (e) {
                    if (scenarioController.hasUnsavedChanges()) {
                        closeModal.modal("show");
                    } else {
                        chrome.app.window.current().close();
                    }
                });
            })();

            const verifyUrlComponent = (function () {
                const my = {};

                const modal = $("#verify-url-modal");
                const verifyUrlButton = $("#verify-url-btn");
                const verifyUrlForm = modal.find("#verify-url-form");
                const currentUrl = modal.find("#verify-url-current-url");
                const verifyHost = modal.find("#verify-url-host");
                const verifyPath = modal.find("#verify-url-path");
                const mismatchWarning = modal.find("#verify-url-mismatch-current-url");
                const invalidRegex = modal.find("#verify-url-invalid-regex");
                const useRegexCheckBox = modal.find("#verify-url-use-regex");
                const submitBtn = modal.find("#verify-url-submit-btn");

                let editVerifyUrlDeferred;

                my.editVerifyUrl = function (verifyUrlAction) {
                    let uri = new URI(scenarioController.getCurrentUrl());
                    currentUrl.val(uri.toString());
                    verifyHost.text(uri.scheme() + "://" + uri.authority() + "/");

                    verifyPath.val(verifyUrlAction.path);
                    useRegexCheckBox.prop("checked", !!verifyUrlAction.regex);
                    mismatchWarning.hide();
                    invalidRegex.hide();

                    editVerifyUrlDeferred = Q.defer();
                    editVerifyUrlDeferred.promise.finally(function () {
                        modal.modal("hide");
                    });
                    modal.modal("show");
                    return editVerifyUrlDeferred.promise;
                };

                verifyUrlButton.click(function () {
                    let uri = new URI(scenarioController.getCurrentUrl());
                    my.editVerifyUrl(VerifyUrlAction.create(uri.resource().slice(1), false))
                        .then(function (verifyUrlAction) {
                            scenarioController.addAction(verifyUrlAction);
                        });
                });

                modal.on("shown.bs.modal", function () {
                    verifyPath.focus();
                });

                verifyUrlForm.submit(function (e) {
                    e.stopPropagation();
                    e.preventDefault();

                    if (checkPath()) {
                        editVerifyUrlDeferred.resolve(VerifyUrlAction.create(verifyPath.val(),
                            useRegexCheckBox.is(":checked")));
                    }
                });

                let checkPath = function () {
                    if (verifyPath.val() === "") {
                        mismatchWarning.hide();
                    } else {
                        var currentResource = new URI(scenarioController.getCurrentUrl()).resource();
                        if (currentResource.toString().startsWith("/")) {
                            currentResource = currentResource.slice(1);
                        }

                        var match = false;
                        if (useRegexCheckBox.is(":checked")) {
                            var regex = utils.isValidRegex("^" + verifyPath.val() + "$", "i");

                            if (regex) {
                                invalidRegex.hide();
                                match = regex.test(currentResource);
                            } else {
                                mismatchWarning.hide();
                                invalidRegex.show();
                                submitBtn.prop("disabled", true);
                                return false;
                            }
                        } else {
                            match = (currentResource.toUpperCase() === verifyPath.val().toUpperCase());
                        }

                        if (match) {
                            mismatchWarning.hide();
                        } else {
                            mismatchWarning.show();
                        }
                    }

                    submitBtn.prop("disabled", false);
                    return true;
                };

                verifyPath.on("input", checkPath);
                useRegexCheckBox.change(checkPath);

                return my;
            }());

            const browserComponent = (function () {

                let backBtn = $("#browser-back-btn");
                let forwardBtn = $("#browser-forward-btn");
                let reloadBtn = $("#browser-reload-btn");
                let hoverBtn = $("#browser-hover-btn");

                backBtn.click(function () {
                    scenarioController.addBackStep();
                });

                forwardBtn.click(function () {
                    scenarioController.addForwardStep();
                });

                reloadBtn.click(function () {
                    scenarioController.addReloadStep();
                });

                hoverBtn.click(function () {
                    scenarioController.captureSelection(function (element) {
                        if (element) {
                            scenarioController.addAction(BrowserAction.create("hover", {element: element}));
                        }
                    });
                });
            }());

            const editStepComponent = (function () {
                let my = {};
                let modal = $("#edit-step-modal");
                let form = $("#edit-step-form");
                let locateElementRadio = $("input[name=edit-step-radio-group-locate-element]:radio");
                let locateElementRadioElementId = $("#edit-step-radio-element-id");
                let locateElementTextElementId = $("#edit-step-text-element-id");

                let locateElementRadioCssSelector = $("#edit-step-radio-css-selector");
                let locateElementTextCssSelector = $("#edit-step-text-css-selector");

                let locateElementRadioXPath = $("#edit-step-radio-xpath");
                let locateElementTextXPath = $("#edit-step-text-xpath");

                let editStepError = $("#edit-step-error");

                let editingStep = null;

                var enableLocatorMethod = function (locatorMethod) {
                    switch (locatorMethod) {
                        case "id":
                            locateElementRadioElementId.prop("checked", true);
                            locateElementRadioCssSelector.prop("checked", false);
                            locateElementRadioXPath.prop("checked", false);
                            locateElementTextElementId.prop("disabled", false);
                            locateElementTextCssSelector.prop("disabled", true);
                            locateElementTextXPath.prop("disabled", true);
                            break;
                        case "css":
                            locateElementRadioElementId.prop("checked", false);
                            locateElementRadioCssSelector.prop("checked", true);
                            locateElementRadioXPath.prop("checked", false);
                            locateElementTextElementId.prop("disabled", true);
                            locateElementTextCssSelector.prop("disabled", false);
                            locateElementTextXPath.prop("disabled", true);
                            break;
                        case "xpath":
                            locateElementRadioElementId.prop("checked", false);
                            locateElementRadioCssSelector.prop("checked", false);
                            locateElementRadioXPath.prop("checked", true);
                            locateElementTextElementId.prop("disabled", true);
                            locateElementTextCssSelector.prop("disabled", true);
                            locateElementTextXPath.prop("disabled", false);
                            break;
                        default:
                            console.log("Unknown locatorMethod" + locatorMethod);
                    }
                };

                my.editStep = function (step) {
                    let element = step.element();

                    if (element) {
                        locateElementTextElementId.val(element.id ? element.id : "");
                        locateElementTextCssSelector.val(element.cssSelector ? element.cssSelector : "");
                        locateElementTextXPath.val(element.xpath ? element.xpath : "");

                        if (element.locatorMethod) {
                            enableLocatorMethod(element.locatorMethod);
                        } else {
                            // No locatorMethod, which mean user has not set it yet.
                            // Use id if exist, otherwise use css selector.
                            if (element.id) {
                                enableLocatorMethod("id");
                            } else {
                                enableLocatorMethod("css");
                            }
                        }
                    } else {
                        // Step has no element. Should not be in here for now.
                        locateElementRadioElementId.prop("disabled", true);
                        locateElementRadioCssSelector.prop("disabled", true);
                        locateElementRadioXPath.prop("disabled", true);
                    }

                    editingStep = step;

                    editStepError.text("");
                    modal.modal("show");
                };

                locateElementRadio.change(function () {
                    if (locateElementRadioElementId.is(":checked")) {
                        enableLocatorMethod("id");
                    } else if (locateElementRadioCssSelector.is(":checked")) {
                        enableLocatorMethod("css");
                    } else if (locateElementRadioXPath.is(":checked")) {
                        enableLocatorMethod("xpath");
                    }
                });

                form.submit(function (e) {
                    e.preventDefault();

                    if (locateElementRadioElementId.is(":checked")) {
                        if (locateElementTextElementId.val() === "") {
                            editStepError.text("Element Id is required");
                            return;
                        }
                    } else if (locateElementRadioCssSelector.is(":checked")) {
                        if (locateElementTextCssSelector.val() === "") {
                            editStepError.text("CSS Selector is required");
                            return;
                        }
                    } else if (locateElementRadioXPath.is(":checked")) {
                        if (locateElementTextXPath.val() === "") {
                            editStepError.text("XPath is required");
                            return;
                        }
                    }

                    if (locateElementRadioElementId.is(":checked")) {
                        editingStep.editElement(function (element) {
                            element.locatorMethod = "id";
                            element.id = locateElementTextElementId.val();
                        });
                    } else if (locateElementRadioCssSelector.is(":checked")) {
                        editingStep.editElement(function (element) {
                            element.locatorMethod = "css";
                            element.cssSelector = locateElementTextCssSelector.val();
                        });
                    } else if (locateElementRadioXPath.is(":checked")) {
                        editingStep.editElement(function (element) {
                            element.locatorMethod = "xpath";
                            element.xpath = locateElementTextXPath.val();
                        });
                    }
                    scenarioController.stepUpdated();
                    modal.modal("hide");
                });

                return my;
            })();

            const dataInsertComponent = (function () {
                const dataInsertButton = $("#data-insert-btn");
                const dataInsertModal = $("#data-insert-modal");
                const dataInsertForm = $("#data-insert-form");
                const dataInsertError = $("#data-insert-error");
                const dataInsertDataSelectMenu = $("#data-insert-data-select");
                const dataSelectProjectData = dataInsertDataSelectMenu.find("#project-data-option-group");
                const dataSelectScenarioData = dataInsertDataSelectMenu.find("#scenario-data-option-group");

                const elementSelectBtn = $("#data-insert-element-select");
                const selectedElementName = $("#data-insert-selected-element-name");

                const dataInsertManageData = $("#data-insert-manage-data");

                var selectedElement = null;
                var dataInsertDeferred;

                const my = {};

                dataInsertButton.click(function (e) {
                    e.preventDefault();
                    dataInsertComponent.insertData(DataInsertAction.create(null, null))
                        .then(function (action) {
                            scenarioController.addAction(action, {perform: true});
                        });
                });

                my.insertData = function (action) {
                    let dataSets = scenarioController.getDataSets();

                    dataSelectProjectData.empty();
                    dataSelectScenarioData.empty();
                    if (dataSets.project) {
                        if (dataSets.project.count > 0) {
                            dataSets.project.forEach(function (data) {
                                dataSelectProjectData.append($("<option />", {value: data.name}).text(data.name));
                            });
                        } else {
                            dataSelectProjectData.append($("<option />", {disabled: "disabled"}).text("<none>"));
                        }
                    }
                    if (dataSets.scenario.count > 0) {
                        dataSets.scenario.forEach(function (data) {
                            dataSelectScenarioData.append($("<option />", {value: data.name}).text(data.name));
                        });
                    } else {
                        dataSelectScenarioData.append($("<option />", {disabled: "disabled"}).text("<none>"));
                    }

                    if (action.dataName) {
                        let option;
                        if (action.dataOrigin === "project") {
                            option = dataSelectProjectData.children("option[value='" + action.dataName + "']");
                        } else {
                            option = dataSelectScenarioData.children("option[value='" + action.dataName + "']");
                        }
                        if (option[0]) {
                            option.attr("selected", "selected");
                        } else {
                            console.error("Editing DataInsertAction data does not exist anymore. Ignoring.");
                        }
                    }
                    setSelectedElement(action.element);

                    dataInsertDeferred = Q.defer();
                    dataInsertModal.modal("show");
                    return dataInsertDeferred.promise;
                };

                dataInsertForm.submit(function (e) {
                    e.preventDefault();
                    e.stopPropagation();

                    let selectedDataOption = dataInsertDataSelectMenu.find(":selected");

                    let origin;
                    if ($.contains(dataSelectProjectData[0], selectedDataOption[0])) {
                        origin = "project";
                    } else if ($.contains(dataSelectScenarioData[0], selectedDataOption[0])) {
                        origin = "scenario";
                    } else {
                        dataInsertError.text("Please select data to insert");
                        return;
                    }

                    if (!selectedElement) {
                        dataInsertError.text("Please select an element");
                        return;
                    }

                    dataInsertDeferred.resolve(
                        DataInsertAction.create(selectedElement, origin, selectedDataOption.val()));

                    dataInsertModal.modal("hide");
                });

                elementSelectBtn.click(function (e) {
                    e.preventDefault();

                    scenarioController.captureSelection(function (element) {
                        if (element) {
                            setSelectedElement(element);
                        }
                    });
                });

                dataInsertModal.on("hidden.bs.modal", function (e) {
                    dataInsertError.text('');
                    selectedElementName.text("<none>");
                    selectedElement = null;
                    dataInsertDataSelectMenu[0].selectedIndex = 0;
                });

                function setSelectedElement(element) {
                    selectedElement = element;
                    selectedElementName.html(element ? element.toString() : "&lt;none&gt;");
                }

                dataInsertManageData.click(function (e) {
                    e.preventDefault();

                    dataInsertModal.modal("hide");
                    dataManageComponent.show();
                });

                return my;
            })();

            const dataManageComponent = (function () {
                const dataManageModal = $("#data-manage-modal");
                const dataManageTBody = $("#data-manage-table > tbody");
                const dataManageError = $("#data-manage-error");
                const dataManageForm = $("#data-manage-form");
                const dataManageHelp = $("#data-manage-help");

                const dataManageAddForm = $("#data-manage-add-form");
                const dataManageAddName = $("#data-manage-add-name");
                const dataManageAddValue = $("#data-manage-add-value");
                const dataManageAddRegex = $("#data-manage-add-regex");

                const my = {};

                dataManageAddForm.submit(function (e) {
                    e.preventDefault();

                    if (dataManageAddName.val() === "") {
                        dataManageError.text("Data name is required to add new data");
                        return;
                    }
                    dataManageError.text("");

                    let newRow = createRow(
                        dataManageAddName.val(),
                        dataManageAddValue.val(),
                        dataManageAddRegex.is(":checked"));
                    dataManageTBody.append(newRow);
                    dataManageAddName.val('');
                    dataManageAddValue.val('');
                    dataManageAddRegex.prop("checked", false);
                });

                dataManageModal.on("show.bs.modal", function (e) {
                    dataManageError.text("");

                    let dataSets = scenarioController.getDataSets();
                    dataManageTBody.empty();
                    dataSets.scenario.forEach(function (data) {
                        dataManageTBody.append(createRow(data.name, data.value, data.regex));
                    });
                    dataManageAddName.val('');
                    dataManageAddValue.val('');
                    dataManageAddRegex.val('');
                });

                dataManageForm.submit(function (e) {
                    e.preventDefault();

                    clearDataRowError();

                    let dataArray =
                        dataManageTBody.children('tr.data-manage-added-data').map(function (index, tr) {
                            return {
                                name: $(tr).find(".data-manage-data-name input").val(),
                                value: $(tr).find(".data-manage-data-value input").val(),
                                regex: $(tr).find(".data-manage-data-regex input").is(":checked")
                            };
                        }).toArray();

                    if (dataArray.find(function (d, index) {
                            if (!d.name) {
                                showDataRowError(index, "Data name is required");
                                return true;
                            }
                            let err = DataSet.isDataValid(d);
                            if (err) {
                                showDataRowError(index, err);
                                return true;
                            }
                            return false;
                        })) {
                        return;
                    }

                    for (let i = 0; i < dataArray.length - 1; i++) {
                        for (let j = i + 1; j < dataArray.length; j++) {
                            if (dataArray[i].name === dataArray[j].name) {
                                showDataRowError(i, "Data name can not be used more than once");
                                showDataRowError(j, "Data name can not be used more than once");
                                return;
                            }
                        }
                    }

                    let dataSet = DataSet.createWithJson({});
                    Promise.all(dataArray.map(function (d, index) {
                        return dataSet.addData(d).catch(function (err) {
                            dataManageTBody.find("tr:nth-child(" + (index + 1) + ")").addClass('danger');
                            dataManageError.text(err);
                            return Promise.reject(err);
                        });
                    })).then(function () {
                        scenarioController.updateScenarioDataSet(dataSet);
                        dataManageModal.modal("hide");
                    });
                });

                dataManageTBody.on("click", ".js-remove-data", function (e) {
                    e.preventDefault();
                    $(e.target).closest('tr', dataManageTBody).remove();
                });

                function createRow(name, value, regex) {
                    let row = $("<tr />", {"class": "data-manage-added-data"}).append(
                        $("<td />", {"class": "data-manage-data-name"}).append(
                            $("<input />", {"value": name, "class": "form-control"})),
                        $("<td />", {"class": "data-manage-data-value"}).append($("<input />", {
                            "value": value,
                            "class": "form-control"
                        })),
                        $("<td />", {"class": "data-manage-data-regex"}).append(
                            $("<input />", {type: "checkbox"}).prop("checked", regex)),
                        $("<td />", {"title": "Remove", "class": "js-remove-data"}).append(
                            $("<button />", {"class": "btn btn-danger btn-sm"}).text("Remove"))
                    );
                    return row;
                }

                function clearDataRowError() {
                    dataManageTBody.children('tr').removeClass("danger");
                    dataManageError.text('');
                }

                function showDataRowError(rowIndex, error) {
                    dataManageTBody.find("tr:nth-child(" + (rowIndex + 1) + ")").addClass("danger");
                    dataManageError.text(error);
                }

                my.show = function () {
                    dataManageModal.modal("show");
                };

                return my;
            })();

            scenarioController.addListener("editStep", function (step) {
                if (step.type === "MouseStep" || step.type === "KeyStep" || step.type === "TabStep") {
                    editStepComponent.editStep(step);
                } else if (step.type === "SingleActionStep") {
                    if (step.action.is(WaitTimeAction)) {
                        waitTimeComponent.editWaitTime(step.action).then(function (waitTimeAction) {
                            scenarioController.updateAction(step.action, function () {
                                return waitTimeAction;
                            });
                        });
                    } else if (step.action.is(VerifyUrlAction)) {
                        verifyUrlComponent.editVerifyUrl(step.action).then(function (verifyUrlAction) {
                            scenarioController.updateAction(step.action, function () {
                                return verifyUrlAction;
                            });
                        });
                    } else if (step.action.is(VerifyTextAction)) {
                        VerifyTextComponent.editVerifyText(step.action).then(function (action) {
                            scenarioController.updateAction(step.action, function () {
                                return action;
                            });
                        });
                    } else if (step.action.is(DataInsertAction)) {
                        dataInsertComponent.insertData(step.action).then(function (action) {
                            scenarioController.updateAction(step.action, function () {
                                return action;
                            });
                        });
                    } else {
                        console.error("Unknown SingleActionStep action for edit: %O", step);
                    }
                } else {
                    console.error("Unknown step type for edit: %O", step);
                }
            });

            $(".js-home").on("click", function (e) {
                windows.openHomeWindow();
            });

            $(".js-tutorial-start").on("click", function (e) {
                bootstro.start(".bootstro", bootstroOptions);
            });

        });
    });

});

define("scenario/new_scenario", function () {
});