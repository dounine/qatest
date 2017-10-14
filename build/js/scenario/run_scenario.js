

requirejs(["jquery", "bootstrap", "scenario/scenario_controller", "windows"], function ($, _b, scenarioController, windows) {
    'use strict';
    $(function () {

        $("#result-label-fail").popover();

        var setStatusLabel = function (status, errorMessage) {
            $(".result-label").css('display', 'none');

            switch (status) {
                case TEST_STATUS.Initializing:
                    $("#result-label-initializing").css('display', 'inline-block');
                    break;
                case TEST_STATUS.Running:
                    $("#result-label-running").css('display', 'inline-block');
                    break;
                case TEST_STATUS.Pass:
                    $("#result-label-pass").css('display', 'inline-block');
                    break;
                case TEST_STATUS.Fail:
                    $("#result-label-fail").css('display', 'inline-block');
                    $("#result-label-fail").attr("data-content", errorMessage);
                    break;
            }
        };

        var run = function () {
            setStatusLabel(TEST_STATUS.Running);

            //执行结果
            scenarioController.reset(function (err) {
                if (!err) {
                    setStatusLabel(TEST_STATUS.Pass);
                } else {
                    setStatusLabel(TEST_STATUS.Fail, err);
                }
            });
        };

        $("#scenario-name").text(baseScenario.name);

        setStatusLabel(TEST_STATUS.Initializing);

        $(".js-home").on("click", function (e) {
            windows.openHomeWindow();
        });

        var rerun = document.querySelector("#rerun");
        rerun.addEventListener("click", run);

        chrome.runtime.getBackgroundPage(function (bg) {
            $(".js-scenario-device-size").append(bg.device.getLabel(baseScenario.deviceSize));

            $(".js-close").on("click", function (e) {
                if (window.hideForWindowClose) {
                    chrome.app.window.current().hide();
                    window.dispatchEvent(new Event("onHidden"));
                } else {
                    chrome.app.window.current().close();
                }
            });


            scenarioController.initializeForRun(bg.syncEngine, bg.device, startUrl, baseScenario, baseScenarioResult, savingResult);
            run();

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

            bg.mixpanel.track("开始场景测试");
        });

    });
});

define("scenario/run_scenario", function () {
});

