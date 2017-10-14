define('scenario/webview', ["jquery", "Element", "windows", "q", "EventEmitter", "scenario/keycode"], function ($, Element, windows, Q, EventEmitter, keyCode) {
    'use strict';

    const WEBVIEW_ID = 'wv';
    //EventEmitter 是一个队列事件
    const webview = new EventEmitter();

    var webviewElement;

    var webviewStatus; // Based on webview load events
    var webviewInitialized; // Indicate if webview initialized with helper scripts
    var currentURL;

    var readyDeferred = null;

    webview.create = function (options) {
        options = options || {};

        if (webviewElement) {
            webviewElement.off(".manualtest");
            webviewElement.remove();
        }

        //chrome 中提供的webview组件
        webviewElement = $(document.createElement('webview'));
        webviewElement.attr("partition", 'p' + (new Date()).getTime().toString().substring(8, 13));
        webviewElement.attr("id", WEBVIEW_ID);
        webviewElement.css({width: options.width, height: options.height});

        if (options.userAgent) {
            webviewElement.get(0).setUserAgentOverride(options.userAgent);
        }

        webviewElement.on('contentload.manualtest', function (e) {
            console.log("内容加载");
            // Load inject.js and prepare page only when a new document is loaded
            initializePage();
        });

        webviewElement.on('loadstop.manualtest', function (e) {
            console.log("内容加载完成");
            webviewStatus = 'stop';
            checkReady();
        });
        webviewElement.on('loadstart.manualtest', function (e) {
            let evt = e.originalEvent;
            console.log("内容开始加载: isTopLevel: " + evt.isTopLevel);
            if (evt.isTopLevel) {
                webviewStatus = 'start';
                webviewInitialized = false; // set to true by ping response from webview content
                checkReady();

                // Fire InitializeStart to let scenario controller to mask the page to prevent user interaction.
                // Page is unmasked once the page is initialized, by receiving ping from the embedded page.
                // This assumes every loadstart will be followed by a contentload event, which initialize the page
                // when fired.
                webview.emitEvent("initializeStart");
            }
        });
        webviewElement.on('loadcommit.manualtest', function (e) {
            let src = webviewElement.get(0).src, evt = e.originalEvent;
            console.log("loadcommit: isTopLevel: " + evt.isTopLevel + " urlChanged: " + (src !== currentURL));
            if (src !== currentURL) {
                console.log("URL changed from " + currentURL + " to " + src);
                currentURL = src;
                webview.emitEvent("urlChanged", [currentURL]);
            }
        });

        webviewElement.on('loadabort.manualtest', function (e) {
            let evt = e.originalEvent, msg;
            console.log("loadabort: isTopLevel: %s, reason: %s ", evt.isTopLevel, evt.reason);
            if (evt.isTopLevel) {
                webviewStatus = 'abort';
                switch (evt.reason) {
                    case 'ERR_CONNECTION_REFUSED':
                        msg = "Connection refused";
                        break;
                    case 'networkError':
                        msg = "Network error";
                        break;
                    case 'sslError':
                        msg = "SSL error";
                        break;
                    case 'safeBrowsingError':
                        msg = "Safe browsing error";
                        break;
                    case 'ERR_NAME_NOT_RESOLVED':
                        msg = "Web address can not be resolved";
                        break;
                    case 'ERR_ADDRESS_UNREACHABLE':
                        msg = "Web address can not be reached";
                        break;
                    default:
                        console.log("loadabort with unknown reason: %s. Ignoring.", evt.reason);
                        msg = null;
                }
                if (msg) {
                    console.error("webview halt: " + msg);
                    webview.emitEvent('halt', [msg]);
                }
                checkReady();
            }
        });

        webviewElement.get(0).request.onHeadersReceived.addListener(
            function (details) {
                if (details.statusLine && details.statusLine.indexOf("500 Internal Server Error") > -1) {
                    console.error("webview halt: " + "Page received: Internal Server Error");
                    webview.emitEvent('halt', ["Page received: Internal Server Error"]);
                }
            },
            {
                urls: ["<all_urls>"],
                types: ["main_frame", "xmlhttprequest"]
            },
            []
        );

        webviewElement.on('exit.manualtest', function (e) {
            let evt = e.originalEvent, msg;
            switch (evt.reason) {
                case "normal":
                case "abnormal":
                    msg = "Page exited";
                    break;
                case "crash":
                    msg = "Page crashed";
                    break;
                case "kill":
                    msg = "Page killed";
                    break;
            }
            console.error("webview halt: " + msg);
            webview.emitEvent('halt', [msg]);
        });

        webviewElement.on('consolemessage.manualtest', function (e) {
            console.log('webview: ' + e.originalEvent.message);
        });

        checkReady();
    };

    webview.appendTo = function (container) {
        container.append(webviewElement);
    };

    webview.navigate = function (url) {
        webview.clearAllData(function () {
            console.log("webview navigate to: " + url);
            webviewInitialized = false;
            webviewStatus = undefined;
            currentURL = url;
            webviewElement.attr('src', url);
            checkReady();
        });
    };

    webview.clearAllData = function (cb) {
        console.log("clear all data");
        webviewElement.get(0).clearData(
            {'since': 0}, {
                'appcache': true,
                'cookies': true,
                'fileSystems': true,
                'indexedDB': true,
                'localStorage': true,
                'webSQL': true
            },
            cb());
    };

    // Return a promise that work can use then-able
    // to wait until the webview is ready to run
    webview.ready = function () {
        return readyDeferred.promise;
    };

    const checkReady = function () {
        if ((webviewStatus === 'stop' || webviewStatus === 'abort') && webviewInitialized) {
            // if webview is initialized, and the page has stopped loading
            // and the ready promise is not resolved yet, resolve it
            // so work waiting for webview to be ready can proceed
            if (readyDeferred.promise.isPending()) {
                readyDeferred.resolve();
            }
        } else {
            // if webview is new, or it was currently in ready state,
            // change to not ready state and use new deferred
            // Note: must only use new deferred when the last deferred is resolved,
            // this relies on checkReady is called when called when load stop/abort
            if (!readyDeferred || !readyDeferred.promise.isPending()) {
                readyDeferred = Q.defer();
            }
        }
    };

    webview.getCurrentUrl = function () {
        return currentURL;
    };

    webview.performEvents = function (events) {
        return new Promise(function (fulfill, reject) {
            messageHandler.postMessage({
                type: "performEvents",
                value: JSON.stringify(events)
            }, function (results) {
                fulfill(results);
            });
        });
    };

    webview.performReady = function (getActionsPromise) {
        const RESOURCE_UNLOADED = "resourceUnloaded";

        return webview.ready().then(function () {
            var initStarted = new Promise(function (fulfill, reject) {
                webview.addOnceListener("initializeStart", function () {
                    fulfill(RESOURCE_UNLOADED);
                });
            });

            var actionsPerformed = getActionsPromise();

            // Race between webview page unload its resource and therefore can't reply,
            // and receiving a reply from the performed event
            return Promise.race([initStarted, actionsPerformed]).then(function (value) {
                if (value === RESOURCE_UNLOADED) {
                    // Didn't receive a result before webview unload its resource, try again
                    console.log("Didn't receive a result before webview unload its resource, try again");
                    return webview.performReady(getActionsPromise);
                } else {
                    return value;
                }
            });
        });
    };

    /*
    cb - callback with element when selection is captured and received from webview
       - callback with null if selection is stopped.
    cb is always called.
  */
    webview.startCaptureSelection = function (cb) {
        messageHandler.registerListener('hoverResult', function (result) {
            webview.emitEvent("hover", [result.bounds]);
        });
        messageHandler.registerListener('selectResult', function (result) {
            cb(Element.createWithJson(result));
        });
        messageHandler.postMessage({
            type: 'selectStart'
        });
        messageHandler.postMessage({
            type: 'reportHoverStart'
        });
    };

    /* stopping selection. Caused by user cancelling.
  */
    webview.stopCaptureSelection = function () {
        messageHandler.postMessage({
            type: 'selectStop'
        });
        messageHandler.postMessage({
            type: 'reportHoverStop'
        });
        messageHandler.unregisterListener('selectResult');
        messageHandler.unregisterListener('hoverResult');
    };

    webview.reload = function () {
        console.log("Reloading webview");
        webviewElement.get(0).reload();
    };

    webview.canGoBack = function () {
        return webviewElement.get(0).canGoBack();
    };

    webview.back = function (cb) {
        console.log("Go back on webview");
        webviewElement.get(0).back(cb);
    };

    webview.canGoForward = function () {
        return webviewElement.get(0).canGoForward();
    };

    webview.forward = function (cb) {
        console.log("Go forward on webview");
        webviewElement.get(0).forward(cb);
    };

    webview.hover = function (element, cb) {
        messageHandler.postMessage({
            type: 'performHover',
            element: element
        }, function (result) {
            cb(result);
        });
    };

    webview.getElementCoordinates = function (element, cb) {
        messageHandler.postMessage({
            type: 'getElementCoordinates',
            element: element
        }, function (rect) {
            cb(rect);
        });
    };

    webview.scrollToElement = function (element, cb) {
        messageHandler.postMessage({
            type: "scrollToElement",
            element: element
        }, function (success) {
            cb(success);
        });
    };

    webview.searchText = function (element, text, insensitive, not, cb) {
        messageHandler.postMessage({
            type: 'searchText',
            element: element,
            text: text,
            insensitive: insensitive,
            not: not
        }, cb);
    };

    webview.insertString = function (element, string) {
        var value = [];
        for (var i = 0; i < string.length; i++) {
            value.push({
                charCode: string.charCodeAt(i),
                keycode: keyCode.charCodeToKeyCode(string.charCodeAt(i)),
                char: string[i]
            });
        }
        return new Promise(function (fulfill, reject) {
            messageHandler.postMessage({
                type: "insertString",
                element: element,
                value: value
            }, function (result) {
                fulfill(result);
            });
        });
    };

    var messageHandler = {
        callbacks: {},

        // Send a message to webview with an optional callback
        // callback is invoked when the message is replied
        // webview (page.js) must send the messageId back during reply
        postMessage: function (message, cb) {
            var messageId = new Date().getTime();
            if (cb) {
                message.messageId = messageId;
            }
            webviewElement.get(0).contentWindow.postMessage(message, "*");
            if (cb) {
                messageHandler.callbacks[messageId] = cb;
            }
        },
        // Handler message received from webview.
        // if message has an messageId, then invoke the callback it was originated with
        // if message match for a registered listener, invoke the callback
        // callback is invoked with the 'result' property of the message (JSON parsed)
        receiveMessage: function (msg) {
            var result = msg.result ? JSON.parse(msg.result) : null;
            if (msg.messageId && msg.messageId in messageHandler.callbacks) {
                messageHandler.callbacks[msg.messageId](result);
                delete messageHandler.callbacks[msg.messageId];
            }
            if (msg.type && msg.type in messageHandler.callbacks) {
                messageHandler.callbacks[msg.type](result);
            }
        },
        // Register a listener for certain type of message
        registerListener: function (type, cb) {
            this.unregisterListener(type);
            this.callbacks[type] = cb;
        },
        unregisterListener: function (type) {
            delete this.callbacks[type];
        }
    };

    var messageListener = function (e) {
        messageHandler.receiveMessage(e.data);
    };
    window.removeEventListener('message', messageListener);
    window.addEventListener('message', messageListener);

    messageHandler.registerListener('eventData', function (result) {
        var eventData = EventData.createWithJson(result);
        console.log("got eventData from page: %O", eventData);
        webview.emitEvent("eventData", [eventData]);
    });

    messageHandler.registerListener('wheel', function (result) {
//    console.log("wheel scroll by: %i, %i", (result.deltaX || 0) * -1, (result.deltaY || 0) * -1);
        if (result.deltaY) {
            window.scrollBy(0, (result.deltaY || 0) * -1);
        } else if (result.deltaX) {
            $(".scenario-col-main").scrollLeft($(".scenario-col-main").scrollLeft() + (result.deltaX * -1));
        }
    });

    var initializePage = function () {
        console.log("加载 webview 当中...");

        // Execute inject.js for loading the needed js into the embedded page *main *world*
        // Must wait for injectionLoaded from the executed script, because only it knows when
        // the injected scripts is loaded.
        console.log('开始注入js脚本:'+requirejs.s.contexts._.config.baseUrl + "core/inject.js")
        webviewElement.get(0).executeScript({file: requirejs.s.contexts._.config.baseUrl + "core/inject.js"}, function (optional) {
            messageHandler.postMessage({type: "pingInject"});

            // Wait for executing script
            messageHandler.registerListener('injectionLoaded', function (result) {
                // ping webview after injectioned loaded to let it know of the embeder window
                console.log('注入js脚本加载完成');

                messageHandler.postMessage({
                    type: 'ping'
                }, function () {
                    console.log('got ping from webview. Webview initialized.');
                    webviewInitialized = true;
                    webview.emitEvent("initializeStop");
                    checkReady();
                });
            });
        });
    };

    chrome.app.window.current().onBoundsChanged.addListener(function () {
        if (webviewElement) {
            webviewElement.css("height", windows.calculateWebviewHeight());
        }
    });

    return webview;
});
