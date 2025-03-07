"use strict"
const help = document.getElementById("help")
// Cross origin stuff is pretty weird
if (!crossOriginIsolated) {
    help.style.display = "unset"
    help.innerHTML = 'Unfortunately, this fractal viewer won\'t work here. Go to the <a href="https://fractalsky.netlify.app/">working edition</a> to use it!<hr><small>(Using a local copy? You\'ll need make sure it is properly Cross-Origin Isolated, so check the console for more info. If you can\'t do that then you can always mess with the <a href="https://plasma4.github.io/my-site/fractalold.html">old version</a>.)</small><br><button onclick="help.removeAttribute(\'style\')" id="infoClose">Close</button>'
    throw new TypeError("Unfortunately, this website does not work if it is not Cross-Origin Isolated, as it uses SharedArrayBuffer to communicate between workers and to allow the WebAssembly script to work using the same memory addresses. The Cross-Origin-Opener-Policy should be set to same-origin, and the Cross-Origin-Embedder-Policy should be set to require-corp. If you can't figure out how to do so, you can try to use an online web hoster that allows you to modify headers (say, with .htaccess) or use a properly set up localhost with updated headers. Check https://github.com/plasma4/FractalSky for info on how to set this up.")
}
// Set the timeout so there's no trace and so it takes up the most space
setTimeout(console.log, 4, "%cOpening the inspector could activate debugging components that can drag down the code significantly! If this does occur, reload the page after you've closed the inspector.", "font-family:'Gill Sans',Calibri,Tahoma;font-weight:600;font-size:15px")

// Helpful browser hacks
const isFirefox = !!window.InternalError
const isSafari = !!window.GestureEvent

// Wake lock API possibly usable in the future:
function tryWakeLock() {
    if (navigator.wakeLock) {
        try {
            wakeLock = navigator.wakeLock.request("screen");
        } catch (e) {
            // Don't worry about it.
        }
    }
}

const buttons = Array.from(document.getElementsByTagName("button")).slice(2)
const rightClick = document.getElementById("rightClick")
const notice = document.getElementById("notice")
const line = document.getElementById("line")
const sheet = document.getElementById("sheet")
const select = document.getElementById("select")
const canvas = document.getElementById("canvas")
const ctx = canvas.getContext("2d")
const previous = document.getElementById("previous")
const ctx2 = previous.getContext("2d")
const hidden = document.createElement("canvas")
const ctx3 = hidden.getContext("2d")
const percent = document.getElementById("percent")
const welcome = document.getElementById("welcome")
const workerCount = navigator.hardwareConcurrency
var w, h, colorDataStart, wasmLength, dataArray, colorBytes, dataBits, palleteData, colorArray, pixelItem

// Notes for the welcome popup
if (isSafari) {
    notice.textContent = "IMPORTANT: Safari is significantly slower for this program than other browsers, and misses out on a few minor features. Try using a browser like Firefox or Chrome to get the best speed and performance."
}

// To ensure that the site works properly, make sure this value is a multiple of 8 if you want to change it.
const palleteStart = 4
const palleteBytes = 8000
const palleteBytes2 = palleteBytes + palleteStart
var webWorkers = []
var workersDone = 0
var calculationDiff = 1
var rendersComp
var needResize = false
var needRender = false
function setupWebWorkers(amount) {
    var workerLink = "worker.js"
    for (var i = 0; i < amount; i++) {
        var worker = new Worker(workerLink)
        worker.onmessage = function (e) {
            var data = e.data
            if (data === -2) {
                if (++workersDone === workerCount) {
                    workersDone = 0
                    resizeHandler()
                    panX = (-w * 0.5 - 0.5) * zoom - 0.74999
                    panY = (-h * 0.5 - 0.5) * zoom + 1e-5
                    update()
                    setTimeout(() => {
                        welcome.style.opacity = 1
                    }, 200)
                }
            } else if (++workersDone === workerCount) {
                workersDone = 0
                if (data == null) {
                    // Using the optimized render function returns a void, so we can check if that is the case and do something special if it is.
                    requestAnimationFrame(function () {
                        update()
                        completeRender(true)
                    })
                } else {
                    // Actual calculation.
                    pixel = data >= pixels ? -1 : data
                    pixelDiff = Math.round((pixel - originalPixel) * 0.01)
                    var newTime = performance.now()
                    calculationDiff = Math.max(newTime - time, 1)
                    time = newTime
                    // We don't want to creep up the cost with setting changes
                    if (pixel !== -1) {
                        // Cost changes can be somewhat extreme, so we smooth the changes out with this function.
                        cost = 0.9 * cost + Math.max(Math.min(wantedFPS * ((cost + 5000) / (calculationDiff + 1)), cost * 0.25), 5000)
                    }
                    // Update this as needed.
                    unfinished = pixel !== -1
                    update()
                    requestAnimationFrame(completeRender)
                }
            }
        }
        webWorkers.push(worker)
    }
}

function messageWebWorkers(message, addID) {
    for (var i = 0; i < webWorkers.length; i++) {
        if (addID) {
            message.id = i
        }
        webWorkers[i].postMessage(message)
    }
}

// Giant tables of color values (in hexadecimal)
const palletes = [
    [0x0a0aa0, 0x3232ff, 0x00c8ff, 0x00b43c, 0xdcb428, 0x7d643c, 0xdcc8c8, 0xc864aa, 0x820a8c, 0x7d00b9, 0x375ff5, 0x14a0e6, 0x5fe1dc, 0x8ce1c8, 0x9bc87d, 0xf08750, 0xe650aa, 0xa564f0],
    [0xf7c3f1, 0xe7ece9, 0xc8b2af, 0x181519, 0xbfaaae, 0xcac7ca, 0xc9afb3, 0x424141, 0xd1aead, 0xe9e7ea, 0xd0acb4, 0x171516, 0xc59b8e, 0xc4c4c4, 0xc18477, 0x444645, 0xc3995b, 0xeceae7, 0xbcb346, 0x1a1b1b, 0xe3ae54, 0xd0d1cf, 0xcfb6b1, 0x37373b, 0xc8afb1, 0xeaebe7, 0xc0afaf, 0x141415, 0xc2afa8, 0xc7ccca, 0xc2b2ae, 0x403c41, 0xcdb6b1, 0xe6eceb, 0xc6b2bc, 0x151516, 0xc7a9bb, 0xc4c7c4, 0xc992c6, 0x4b4b45, 0xcda2af, 0xe9ebea, 0xc5b3af, 0x1a1419, 0xd6ad97, 0xd4d3d5, 0xd19866, 0x3e393d, 0xd7732e, 0xebe8ec, 0xd29f56, 0x151615, 0xbeb5a9, 0xc4c9ca, 0xc5b8a4, 0x3e4141, 0xc4b6a9, 0xeae6e5, 0xc7bb59, 0x191414, 0xccb979, 0xc7c7c5, 0xbcb0a3, 0x433f42, 0xb5b05b, 0xece5e9, 0xbdb660, 0x161518, 0xc2bb51, 0xd3d9d9, 0xc1bd56, 0x494444, 0xbfbc59, 0xe5e5e5, 0x7f7c3d, 0x1a1919, 0x9e9e47, 0xc3c1c4, 0xc3994c, 0x2e322f, 0xc67f44, 0xe6ebea, 0xc88c7b, 0x151b19, 0xca5693, 0xc6c6c6, 0xc4529d, 0x4f4c4e, 0xb87b8a, 0xe9eceb, 0xaf6d59, 0x1b1b14, 0xbcc054, 0xd6d7d7, 0xb7bf43, 0x3b3535, 0xb4ba55, 0xe6e8ec, 0xb1b952, 0x171817, 0xafb650, 0xc3c1c5, 0xb4c04c, 0x373539, 0xb7c444, 0xe7e9ec, 0xbaa466, 0x191a1a, 0x844435, 0xc8c9c5, 0xd2657a, 0x4d4b4d, 0xbe9e50, 0xe5e7e7, 0xb3bc3d, 0x1b1915, 0xb1be48, 0xd0d2d6, 0xb2c03a, 0x362f35, 0xb1bc47, 0xe7ece5, 0xb0b753, 0x141517, 0x93b94e, 0xc7c9c9, 0x519f03, 0x3d3e43, 0xb3c73d, 0xeaeceb, 0xadc638, 0x181b17, 0xa9c24f, 0xcacbc9, 0x7ebb6b, 0x484948, 0x4ac484, 0xe9e5ec, 0x6fa65f, 0x1a1916, 0xb5c445, 0xd5ced1, 0xb0c548, 0x3c3638, 0xaabf3d, 0xece5e8, 0xb0b74f, 0x19171b, 0xafb948, 0xc9c5ca, 0xaac140, 0x3d3e43, 0xafc13f, 0xe8e5e6, 0xacc234, 0x141416, 0xafc14e, 0xc3c4c2, 0xadbb4f, 0x474747, 0xb1bc4c, 0xe5ebe5, 0x757a2a, 0x151716, 0x393e13, 0xd7d4d3, 0x2d873b, 0x3f3e39, 0x3eaf57, 0xe9e6e9, 0x66b668, 0x141816, 0x9cba4f, 0xc8cbc9, 0xadbf44, 0x3c3d40, 0xb7bc47, 0xeae7e5, 0x68bc39, 0x191917, 0x68c838, 0xc2c3c3, 0xacc559, 0x404645, 0xafb049, 0xeae7ec, 0xb0b552, 0x191914, 0xb0bb3f, 0xd7d3d4, 0xb7b84a, 0x434a43, 0xb6b44f, 0xe5e5ea, 0x98b54e, 0x14181b, 0x55b163, 0xc1c1c6, 0x009800, 0x2c322c, 0x42763d, 0xe8e7e6, 0x64b346, 0x181b15, 0x41c04e, 0xc8c6c7, 0xb6ae5a, 0x524c52, 0xb1b050, 0xeae8e7, 0xb6aa55, 0x141515, 0xb9ad53, 0xd6dad7, 0xbba242, 0x393535, 0xc08d4b, 0xeaeaeb, 0xb65d53, 0x1b181a, 0xb69551, 0xc4c4c4, 0xbaa556, 0x3a353a, 0xbb594f, 0xeae5ec, 0xc27658, 0x181616, 0xbd5756, 0xcacbca, 0xb75d5c, 0x4b4d4e, 0xb75a5a, 0xeae9e9, 0xc05c8b, 0x181b17, 0xcc5cad, 0xd1d0ce, 0xb77bba, 0x353734, 0xc464c5, 0xe9e6e6, 0xb957aa, 0x181515, 0xc45086, 0xc9c5c6, 0xbd56a8, 0x424042, 0xde86ad, 0xe9e5ea, 0xd26899, 0x161b19, 0xb94eb2, 0xc6cbc4, 0x9d67cf, 0x4d464b, 0xb759aa, 0xe6eae9, 0xca6ba7, 0x15171a, 0xc045a1, 0xcfd4d0, 0xc44ba6, 0x393935, 0xc23f7d, 0xe9e7e9, 0xbc53a6, 0x151a18, 0xa540c0, 0xc9c7c6, 0xbd46a4, 0x3f3d43, 0xc846a7, 0xebebea, 0xdb57ce, 0x161518, 0xa858c8, 0xc7c7c5, 0x6b3fca, 0x454a47, 0xb054a7, 0xe9eae8, 0xd176ba, 0x1a181a, 0xca2cb6, 0xd6d8d7, 0xc543a6, 0x403d3c, 0xb24f8c, 0xe6e7ec, 0xb849a9, 0x19171b, 0xb950a8, 0xcac5c9, 0xbf45aa, 0x3e3e3b, 0xc749a9, 0xe5e6e7, 0xc833a1, 0x161419, 0xc03c81, 0xc4c5c1, 0xc33d55, 0x3f4246, 0xdc9942, 0xe6e8e5, 0xb7bd66, 0x171a18, 0xcf8d52, 0xdad5da, 0xc944a8, 0x494549, 0xc34ca9, 0xe9e8e7, 0x9b41bd, 0x181514, 0x8f45ca, 0xc2c1c5, 0xb239c6, 0x2c322f, 0xbd3dc4, 0xebe8ec, 0xca45ae, 0x18161a, 0xc742a6, 0xc3c7c5, 0xb959aa, 0x4c534f, 0xc04eaf, 0xe9eae7, 0xcb34b7, 0x191416, 0x9d1e9f, 0xd8d8d4, 0x791e96, 0x373833, 0x5f1abb, 0xece8ec, 0x9a39dc, 0x161714, 0xa776e0, 0xeceaeb, 0x99abf6, 0x3c3837, 0x76cdf3, 0xe7e9e7, 0x5b95dc, 0x1a1417, 0x5452cd, 0xdfe3e3, 0x7225bc, 0x4c4e4a, 0xb34acb, 0xe8e7eb, 0xc845b3, 0x1b141b, 0xcc51b3, 0xd1d4d4, 0xca4ab7, 0x323433, 0xc452b4, 0xece7e5, 0xbe5cb8, 0x141814, 0xa73c97, 0xc5c9c7, 0x96498c, 0x3a3e3c, 0x81347e, 0xe6e9e9, 0x5e3660, 0x161817, 0x934986, 0xc4c6c4, 0xc255b9, 0x4e4747, 0xbba3b4, 0xe9ece9, 0xc55abe, 0x1b1814, 0xdc91d2, 0xd2d1ce, 0xcd5bc3, 0x393232, 0xcb58bb, 0xebeae9, 0xbfa6b5, 0x151519, 0xc45bb8, 0xcbcbca, 0xc85abc, 0x42403f, 0xcaa3c1, 0xeae6eb, 0xd157c6, 0x151516, 0xd49bca, 0xc4c2c4, 0xc1a3bc, 0x464143, 0xd498c8, 0xe6e5e9, 0xc6a5bf, 0x141a19, 0xe5ace3, 0xd7d6d4, 0xcba6c5, 0x403d3c, 0xcda6c6, 0xe8e7e7, 0xc5a6bf, 0x161716, 0xbeabbd, 0xc4c5c9, 0xcca7c5, 0x3c3e3a, 0xcca9c6, 0xe8e9ec, 0xcb88cb, 0x17181a, 0xb62fb4, 0xc1c2c0, 0xa470bf, 0x454043, 0xc4a8be, 0xe5e7e7, 0xc8aec6, 0x161617, 0xcfabd1, 0xd8d3d5, 0x9d6bcc, 0x454442, 0xd9a6ee, 0xe6ece9, 0xcba1c7, 0x181a18, 0xc288c9, 0xc1c3c7, 0xcbaac6, 0x333333, 0xd0a8cb, 0xe7e9e7, 0xcfb0cf, 0x141a18, 0xc9adcc, 0xcac5c7, 0xc0adbe, 0x53524d, 0xc1acbf, 0xe5e9e8, 0xdb9ccc, 0x141914, 0xd3aad0, 0xd5dbd7, 0x9983cf, 0x363a34, 0x8a70d2, 0xece7ec, 0x6297ec, 0x161419, 0x68c9e2, 0xedeff4, 0x46cc8c, 0x373d39, 0x93ce3f, 0xe5e6eb, 0xcac25c, 0x151415, 0xd4aa4b, 0xdce1db, 0xe27eda, 0x4d4a4b, 0xc999cb, 0xe6ecea, 0xc7a8cc, 0x19161a, 0xccafc8, 0xcfced3, 0xc7a7d2, 0x373539, 0xbfb0cb, 0xeae9e6, 0xbeaabe, 0x171a17, 0xbaa4be, 0xc6c4ca, 0xbca9c4, 0x3d403b, 0xc6a9cf, 0xe6e9e9, 0xc8aad1, 0x181915, 0xbeaac9, 0xcac4cb, 0xbda4c5, 0x4a4b4f, 0xb7abc2, 0xe8e9e7, 0xbeabc9, 0x1a1b19, 0xc4a9d2, 0xced2d1, 0xc1abce, 0x303736, 0xb9a9c8, 0xeae7e7, 0xb8aabc, 0x18141a, 0xb2a3c3, 0xc8c7c9, 0xb5a6c5, 0x444344, 0x967dc0, 0xebe5e8, 0x9574ec, 0x191a14, 0x9d85e4, 0xc6c6c2, 0xa38ec5, 0x424540, 0xb2a3c4, 0xe5e7e8, 0xb7a6c8, 0x161b17, 0xc1aec8, 0xd5d8d4, 0xb2a6cb, 0x42413e, 0xb3aac7, 0xe5ebe9, 0xb1a7c1, 0x191816, 0xafaac2, 0xcac8c6, 0xaea6ca, 0x3a3f39, 0xb3a8cc, 0xece5e6, 0xc4a7cf, 0x1a1b19, 0xd898cd, 0xc3c4c2, 0xcd8fc1, 0x414341, 0xdd81bf, 0xece9ec, 0xda61b2, 0x151818, 0xe590d8, 0xd9d7d5, 0xb1a6cf, 0x444340, 0xaca7cb, 0xe5e5ec, 0xaaa9c6, 0x181519, 0xa6a4bd, 0xc6c2c0, 0xa3a4cd, 0x2c2f2f, 0xa4a6d1, 0xece5e7, 0xa7accc, 0x1b1915, 0xaaa6c7, 0xcac5c7, 0xa9aec3, 0x514f50, 0xa5a4c7, 0xeceae6, 0xa4a5cc, 0x1b1418, 0xa7a4ce, 0xdadbda, 0x969ac9, 0x3a3b34, 0xb6b2ea, 0xeceaeb, 0x97b7ee, 0x1b1a1a, 0x72b8e9, 0xe2e1e3, 0xa6adca, 0x383b36, 0xa5a2ce, 0xece6ec, 0xa6a6ce, 0x19171a, 0xa5a6c7, 0xcbc6c8, 0xaaa8be, 0x4a4b4b, 0xa8a7c1, 0xeaeaeb, 0x99a8eb, 0x171415, 0x8d94ed, 0xd1ced2, 0x79c5ec, 0x363535, 0x7aa7eb, 0xece7eb, 0x98a2d3, 0x141415, 0xa8a8c4, 0xcdd0d1, 0xaaa4c7, 0x3c3d3f, 0x9c96df, 0xeceae8, 0xa8a4ca, 0x1a1417, 0xa6a8c6, 0xcbc6c9, 0xa8a5bc, 0x4f504c, 0xaeaebb, 0xece7e9, 0xa8a6c6, 0x171b17, 0xa9aaca, 0xd5d0d2, 0xa7a4c7, 0x323135, 0xb491d6, 0xece5e7, 0xac80d6, 0x14151a, 0xbf6cd9, 0xc9c7ca, 0x956de0, 0x454545, 0x7e7ced, 0xe5e8eb, 0xa3a5bd, 0x151917, 0x8e83af, 0xd9d7d5, 0xaaa3b2, 0x433f3e, 0xa7a3b4, 0xe9eae9, 0xaca6b3, 0x181414, 0xa2a6c2, 0xd7d9d5, 0xb2a5b3, 0x423e3d, 0xaca7b5, 0xe7e9e7, 0xaca4ae, 0x151616, 0xaca7b1, 0xcbc5c4, 0x918ebd, 0x3a3b3c, 0xb2a6b0, 0xeae7ea, 0xd4b1d3, 0x1b161b, 0xcb98c6, 0xc3c1c1, 0xe5c7ee, 0x474644, 0xae88df, 0xeae8ea, 0xae61dd, 0x19181b, 0xb45da3, 0xd7d5d9, 0xc94b6e, 0x423f3f, 0xd2a188, 0xece9e7, 0xd28339, 0x161b1a, 0xc5a04b, 0xc6c4c3, 0xc17644, 0x2f2f33, 0xb55e51, 0xebe9e9, 0xc3984c, 0x171614, 0xae9d2e, 0xc5c7c7, 0xb6a660, 0x514e4e, 0xb0a556, 0xeaecea, 0xbe884e, 0x141914, 0xc46e3b, 0xdad4d7, 0xb58a43, 0x35343a, 0xb9a557, 0xe9ece5, 0xb6a355, 0x15161a, 0xb7a657, 0xc7c4c3, 0xb9a957, 0x36363b, 0xc5b037, 0xeae5e6, 0xbca54c, 0x171517, 0xb45b48, 0xcbcacb, 0xb05e51, 0x4c4b49, 0xb3a74e, 0xeae9e5, 0xb85d42, 0x171916, 0xb9a449, 0xd0d3d2, 0xbc5942, 0x393638, 0xbaa44b, 0xeae7e6, 0xb7a653, 0x161a19, 0xb45b45, 0xc4c3c7, 0xb7a149, 0x383d3f, 0xbb5939, 0xecece7, 0xb85840, 0x18181a, 0xb9a44e, 0xc4c6c9, 0xb2604c, 0x4a4f4e, 0xb9ab53, 0xeae9e9, 0xb55943, 0x141917, 0xb95d43, 0xd4d5d5, 0xb65741, 0x302f33, 0xb85740, 0xe7eaeb, 0xb5a551, 0x181917, 0xb05b50, 0xc9c5ca, 0xb5a64b, 0x444647, 0xb9a547, 0xeae5ea, 0xbb5d3f, 0x161516, 0xb5a852, 0xc4c6c4, 0xb15b4b, 0x434043, 0xb05e50, 0xe5e9eb, 0xb9a64b, 0x181b19, 0xba5c44, 0xd2d8d6, 0xb9a64f, 0x454445, 0xb6a04c, 0xe8e8e6, 0xb3a557, 0x191619, 0xb4a55a, 0xcac4c9, 0xaf5a4e, 0x36353a, 0xb9a954, 0xe6eaea, 0xb1564e, 0x141818, 0xb5a857, 0xc5c1c5, 0xafa35d, 0x454849, 0xb4a459, 0xe8ebe9, 0xc3b397, 0x141b14, 0xafa85a, 0xd8d6d7, 0xb3a35c, 0x43443f, 0xb3c15c, 0xe6e5e6, 0x9cd083, 0x17161b, 0x5abb50, 0xc3c4c2, 0xd2cb4c, 0x322f32], // this was NOT manually done; don't worry
    [0xc8c8ff, 0x4cdbff, 0x692d7, 0x122c91, 0x371663, 0x600d39, 0x8a030f, 0xbf2600, 0xfb6200, 0xffc9a6, 0x000000]
]
const interiors = [0xff000000, 0xff000000, 0xff000000, 0xffffffff]
const totalPalletes = palletes.length

function setupPalletes() {
    // Constants can be modified with push(), so this is quite all right.
    for (var i = 0; i !== totalPalletes; i++) {
        var pallete = palletes[i]
        // Add transparency values
        var start = pallete[0] ^ 0xff000000
        pallete[0] = start
        pallete.push(start)
    }
}

setupPalletes()

var palleteOverride = false
var palleteID = 0
var pallete = palletes[palleteID]
var interior = interiors[0]
var palleteLen = pallete.length - 1

var pixels = Math.round(innerWidth * devicePixelRatio) * Math.round(innerHeight * devicePixelRatio)
var wasmLength = pixels * 12 + palleteBytes2
var flowRate = 0, flowAmount = 0
var resizeW, resizeH
var memory = new WebAssembly.Memory({
    initial: Math.ceil(wasmLength / 65536),
    maximum: 20000,
    shared: true
})
var buffer = memory.buffer
var imageData
var imageDataBuffer

// The justSwitched stuff is JUST for Firefox, which sometimes calls weird false resizes when you switch tabs or windows. (No longer required as the bug was fixed.)
// var justSwitched = false

// document.addEventListener("focus", function () {
// if (isFirefox) {
//     justSwitched = true
//     setTimeout(() => {
//         justSwitched = false
//         var newW = Math.round(innerWidth * devicePixelRatio)
//         var newH = Math.round(innerHeight * devicePixelRatio)
//         if (newW !== w || newH !== h) {
//             resizeHandler()
//         }
//     }, 250)
// }
// })

setupWebWorkers(workerCount)
messageWebWorkers({ mem: memory }, true)

// Firefox is weird about resizing
// justSwitched = false

function hideWelcome() {
    welcome.style.opacity = 0
    setTimeout(() => {
        welcome.remove()
    }, 500)
}

welcome.onclick = e => {
    if (e.button === 0) {
        hideWelcome()
    }
}

document.addEventListener("keydown", function (e) {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.target.tagName !== "INPUT") {
            var code = e.keyCode
            if (!e.shiftKey) {
                if (code === 32) {
                    toggleMenu()
                    e.preventDefault()
                } else if (code === 65) {
                    switchFlow(1)
                } else if (code === 66) {
                    switchFlow(-1)
                } else if (code === 67) {
                    switchFractals()
                } else if (code === 68) {
                    switchDarkenEffect()
                } else if (code === 73) {
                    setIterations(iterations + 250)
                } else if (code === 77) {
                    switchRenderMode()
                } else if (code === 80) {
                    switchPallete()
                } else if (code === 82) {
                    reset()
                } else if (code === 83) {
                    increaseSpeed()
                } else if (code === 84) {
                    toggleBreakdown()
                } else if (code === 88) {
                    switchCategory()
                } else if (code === 90) {
                    switchAliasMode()
                }
            } else if (code === 67) {
                changeFractal(fractalType === 1 ? 16 : fractalType - 1)
            } else if (code === 68) {
                changeDarkenEffect(darkenEffect === 0 ? 3 : darkenEffect - 1)
            } else if (code === 77) {
                switchRenderMode(true)
            } else if (code === 83) {
                decreaseSpeed()
            }
        }
    }
})

function toggleBreakdown() {
    pixelBreakdown = !pixelBreakdown
    colorButton(12, pixelBreakdown)
}

function resizeHandler() {
    // Due to past bugs with Firefox, this code was needed; however, this is no longer the case.
    // if (isFirefox && justSwitched) {
    //     // Ignore this resize
    //     return
    // }

    w = Math.round(innerWidth * devicePixelRatio * aliasingFactor)
    h = Math.round(innerHeight * devicePixelRatio * aliasingFactor)
    imageData = ctx.getImageData(0, 0, w, h)
    imageDataBuffer = imageData.data
    pixels = w * h
    canvas.width = previous.width = hidden.width = w
    canvas.height = previous.height = hidden.height = h
    canvas.style.width = previous.style.width = hidden.style.width = Math.ceil(innerWidth) + "px"
    canvas.style.height = previous.style.height = hidden.style.height = Math.ceil(innerHeight) + "px"

    colorDataStart = pixels * 8 + palleteBytes2
    wasmLength = pixels * 4 + colorDataStart
    expandMemory(wasmLength)

    pixelItem = getMemory(1, 0, 32)
    palleteData = getMemory(palleteBytes * 0.25, palleteStart, 32)
    palleteData.set(pallete)
    dataArray = getMemory(pixels * 2, palleteBytes2, -32)
    colorBytes = getMemory(pixels * 4, colorDataStart, -8) // In the WebAssembly script, it actually is 32-bit, but for getting this to render to the canvas, we pretend it's 8-bit and it works out.
    colorArray = getMemory(pixels, colorDataStart, 32)
    dataBits = getMemory((wasmLength - palleteBytes2) * 0.25, palleteBytes2, 32)
}

function expandMemory(finalByte) {
    var byteLength = buffer.byteLength
    if (byteLength < finalByte) {
        memory.grow(Math.ceil((finalByte - byteLength) / 65536))
        buffer = memory.buffer
    }
}

var zoom = 0.004
var cost = 200000
var iterations = 1000

function getMemory(size, offset, type) {
    if (type === -8) {
        return new Uint8ClampedArray(buffer, offset, size)
    } else if (type === 8) {
        return new Uint8Array(buffer, offset, size)
    } else if (type === 16) {
        return new Uint16Array(buffer, offset, size)
    } else if (type === -32) {
        return new Float32Array(buffer, offset, size)
    } else if (type === 32) {
        return new Uint32Array(buffer, offset, size)
    } else if (type === -64) {
        return new Float64Array(buffer, offset, size)
    } else if (type === 64) {
        return new BigUint64Array(buffer, offset, size)
    }
}

function download(data, filename) {
    var file = new Blob([data])
    var url = URL.createObjectURL(file)
    select.href = url
    select.download = filename
    select.click()
    setTimeout(function () {
        URL.revokeObjectURL(url)
    }, 50)
}

// Movement for touchscreen (confusing)! We have to prevent any zoom of the entire page, however (such as pinch zooming).
document.addEventListener("touchstart", function (e) {
    hideCopy()
    if (mouseDown) {
        e.preventDefault()
        return
    }
    var touches = e.touches
    var length = touches.length
    pinching = length === 2
    if (pinching) {
        e.preventDefault()
    }
    pinching = pinching && !mouseDown
    touchDown = false
    if (pinching) {
        currentX = Math.round((touches[0].clientX + touches[1].clientX) * 0.5 * devicePixelRatio * aliasingFactor)
        currentY = Math.round((touches[0].clientY + touches[1].clientY) * 0.5 * devicePixelRatio * aliasingFactor)
        var xPinch = touches[0].clientX - touches[1].clientX
        var yPinch = touches[0].clientY - touches[1].clientY
        pinchDist = Math.sqrt(xPinch * xPinch + yPinch * yPinch) * devicePixelRatio
    } else if (length === 1) {
        touchDown = true
        currentX = Math.round(touches[0].clientX * devicePixelRatio * aliasingFactor)
        currentY = Math.round(touches[0].clientY * devicePixelRatio * aliasingFactor)
        if (Date.now() - touchTime < 500) {
            updateZoom(0.1, currentX, currentY)
            touchTime = 0
        } else {
            touchTime = Date.now()
        }
    }
}, {
    passive: false
})

document.addEventListener("touchmove", function (e) {
    var touches = e.touches
    if (touches.length === 2) {
        e.preventDefault()
    }
    if (pinching) {
        var firstTouch = touches[0]
        var secondTouch = touches[1]
        var xPinch = firstTouch.clientX - secondTouch.clientX
        var yPinch = firstTouch.clientY - secondTouch.clientY
        var newDist = Math.sqrt(xPinch * xPinch + yPinch * yPinch) * devicePixelRatio * aliasingFactor
        var multiplier = 3 * (pinchDist + 10) / (newDist + 10) - 2
        if (multiplier !== 1) {
            updateZoom(multiplier, currentX, currentY)
        }
        pinchDist = newDist
    } else if (touchDown) {
        var touch = touches[0]
        var newX = Math.round(touch.clientX * devicePixelRatio * aliasingFactor)
        var newY = Math.round(touch.clientY * devicePixelRatio * aliasingFactor)
        diffX += newX - currentX
        diffY += newY - currentY
        currentX = newX
        currentY = newY
    }
}, {
    passive: false
})

document.addEventListener("touchend", () => {
    pinching = false
    touchDown = false
})

setTimeout(hideWelcome, 4000)

var darkenEffect = 0
var fractalType = 1
var renderMode = 0
var pixel = 0
var pixelDiff = 0
var speed = 1
var juliaX = 0
var juliaY = 0
var panX, panY
var juliaMode = false
var pixelBreakdown = false
var rehandle = false
var rerender = false
var unfinished = true
var needsClearing = false
var aliasingFactor = 1
var time = performance.now()
var lastOutput = time
var fps = 10
// Weirdly enough, the lower this value, the higher FPS you want. It's a weird formula.
var wantedFPS = 3.45
var mainTime = 0
// Starting guess for the estimated time left (20 seconds)
var previousGuess = 20000
var hideTime = -1
var scoreSum = 0
var frames = 0
var originalPixel = 0
var diffX = 0
var diffY = 0

function update() {
    if (needResize) {
        completeResize()
    }

    if (pixelBreakdown) { // Useful for debugging and getting info about a specific pixel
        if (currentX >= 0 && currentY >= 0 && currentX < w && currentY < w) {
            var p = currentX + currentY * w
            var iters = dataArray[p]
            var shade = dataArray[p + pixels]
            percent.textContent = "Info for (" + currentX + ", " + currentY + "):\r\nIterations before escaping: " + (iters == null || iters == 0 ? "Not calculated yet" : (iters === -999 ? "Doesn't escape" : iters.toFixed(3))) + "\r\nPallete location: " + (iters === -999 ? "Interior" : iters === 1 ? flowAmount % palleteLen : iters === 0 ? "Not calculated yet" : ((Math.log2(iters) * Math.sqrt(Math.sqrt(speed)) + (iters - 1) * 0.035 * speed + flowAmount) % palleteLen).toFixed(3)) + "\r\nRGB color: " + (colorBytes[4 * p + 3] === 0 ? "Transparent" : colorBytes[4 + p] + ", " + colorBytes[4 * p + 1] + ", " + colorBytes[4 * p + 2]) + "\r\nShading amount: " + (shade === 0 ? "None" : shade.toFixed(6))
        } else if (currentX >= 0 && currentY >= 0) {
            percent.textContent = "Cursor location: (" + currentX + ", " + currentY + ")"
        } else {
            percent.textContent = "Select something for more info."
        }
    } else if (Date.now() >= hideTime) {
        percent.textContent = ""
        hideTime = -1
    }
    if (diffX !== 0 || diffY !== 0) {
        zoomX -= diffX * zoomM
        zoomY -= diffY * zoomM
        doZoom = true
        panX -= diffX * zoom
        panY -= diffY * zoom
        var end = pixels * 2
        var newData = new Float32Array(end)
        var x = -1
        var y = 0
        // Precompute bias to add
        var bias = diffX + w * diffY
        for (var i = 0; i !== pixels; i++) {
            x++
            if (x === w) {
                x = 0
                y++
            }
            var newX = x + diffX
            var newY = y + diffY
            if (newX >= 0 && newY >= 0 && newX < w && newY < h) {
                newData[i + bias] = dataArray[i]
            }
        }
        if (darkenEffect !== 0) {
            // Also properly move the darkening effect values
            x = -1
            y = 0
            for (; i !== end; i++) {
                x++
                if (x === w) {
                    x = 0
                    y++
                }
                var newX = x + diffX
                var newY = y + diffY
                if (newX >= 0 && newY >= 0 && newX < w && newY < h) {
                    newData[i + bias] = dataArray[i]
                }
            }
        }
        dataArray.set(newData)
        colorArray.fill(0)
        unfinished = true
        rerender = true
        diffX = 0
        diffY = 0
    }

    time = performance.now()
    if (unfinished || rehandle) {
        hideTime = Infinity
        originalPixel = pixel
        if (rehandle) {
            // Simple trick for clearing everything; since there is no data, the WASM will recalculate everything.
            dataBits.fill(0)
            setPixel(0)
            rehandle = false
            rerender = false
        } else if (rerender) {
            // Instead of instantly resetting the pixel, it's important to let all the workers finish their tasks to prevent desyncs.
            setPixel(0)
            rerender = false
        }
        messageWebWorkers([1, juliaMode ? -fractalType : fractalType, w, h, 0, panX, panY, zoom, cost, palleteBytes2, colorDataStart, iterations, palleteStart, palleteLen, interior, renderMode, darkenEffect, speed, flowAmount, juliaX, juliaY]) // Message the parameters to be passed into each worker.
    } else {
        line.removeAttribute("style")
        if (flowRate !== 0) {
            flowAmount += flowRate / 120
            if (flowAmount < 0) {
                flowAmount += palleteLen
            } else if (flowAmount >= palleteLen) {
                flowAmount -= palleteLen
            }
        }
        if (flowRate !== 0 || needRender) {
            rehandle = false
            needRender = false
            setPixel(0)
            messageWebWorkers([2, pixels, 0, palleteBytes2, colorDataStart, palleteStart, palleteLen, interior, renderMode, darkenEffect, speed, flowAmount]) // Ultimately, this sends the parameters needed to the render function in each worker.
        } else {
            requestAnimationFrame(update)
        }
    }
}

function completeRender(animatedMode) { // animatedMode must be true in order for this to work; not some value that equals true.
    // Complicated zoom preview using previous data (Safari doesn't work for this, sadly)
    if (doZoom) {
        ctx2.imageSmoothingEnabled = false
        // Prevent canvas weirdness
        ctx2.clearRect(0, 0, w, h)
        // Small previews fade out when they are small or huge. It's a nice touch and also makes it look a bit less cluttery.
        if (zoomM < 6 && zoomM > 0.002) {
            if (zoomM > 2.4) {
                sheet.style.opacity = zoomM / 6
            } else if (zoomM < 0.01) {
                sheet.style.opacity = 1 - 80 * (zoomM - 0.002)
            } else {
                sheet.removeAttribute("style")
            }
            ctx2.drawImage(hidden, zoomX, zoomY, w * zoomM, h * zoomM, 0, 0, w, h)
        }
        needsClearing = true
        doZoom = false
    }

    // If you have a 1-frame render, this prevents it from saying the score is zero.
    scoreSum += cost
    // Determine the number of "frames" a calculation has gone on for.
    frames++
    if (!document.hidden) {
        // Update the image and scores
        var imgTime = performance.now()
        if (animatedMode === true || time - lastOutput > 12) { // To prevent rapid laggy rerenders, make sure it's been over 12ms since the last render.
            lastOutput = time
            updateOutputImage()
        }
        var mainDiff = Math.max(time - mainTime, 1)
        if (unfinished) {
            // 30 FPS is the goal by default, but this can be changed by the user.
            fps = 0.9 * fps + 100 / calculationDiff
            var ratio = pixel / pixels
            // Strange time guessing function. If values are really high and we don't have enough info, we use previous data.
            var timeGuess = previousGuess
            if (ratio !== 0) {
                // Additional ratio statement, because some places render too quickly.
                if (frames < 15) {
                    timeGuess = Math.max(previousGuess - mainDiff, 200)
                } else {
                    // Save the guessed time left.
                    previousGuess = mainDiff / ratio
                    timeGuess = mainDiff * (1 - ratio) / ratio
                }
            }
            if (!pixelBreakdown) percent.textContent = (100 * ratio).toFixed(2) + "% finished (Taking " + timeToString(mainDiff) + ")\r\nEstimated time left: " + timeToString(timeGuess, true) + "\r\nPerformance: " + (cost * 0.001).toFixed(2) + "/thread (for " + workerCount + " " + (workerCount === 1 ? "thread" : "threads") + ").\nRendering took " + (performance.now() - imgTime).toFixed(2) + "ms (running at " + fps.toFixed(1) + "fps)"
            if (pixelDiff >= 768) {
                var brightness = Math.min(255, (pixelDiff >> 2) - 768)
                var color = "rgb(" + brightness + ",255," + brightness + ")"
            } else if (pixelDiff < 256) {
                var color = "rgb(255," + pixelDiff + ",0)"
            } else {
                var color = "rgb(" + ((pixelDiff - 256) >> 1) + ",255,0)"
            }
            percent.style.color = color
            // Update the progress line (which isn't rendered with the canvas to prevent the line from showing in the preview)
            line.style.top = (Math.floor(pixel / (w * aliasingFactor)) / devicePixelRatio).toFixed(1) + "px"
            line.style.backgroundColor = color
        } else {
            previousGuess = mainDiff
            if (!pixelBreakdown) {
                if (flowRate === 0 || mainDiff < 2000) {
                    percent.textContent = "Took " + timeToString(mainDiff, true) + (aliasingFactor === 1 ? "." : " (with the anti-aliasing factor set to " + aliasingFactor + ").")
                } else if (percent.textContent.length !== 0) {
                    percent.textContent = ""
                }
            }
            line.removeAttribute("style")
            percent.style.color = "#1ad"
            hideTime = Date.now() + 500
            scoreSum = 0
            frames = 0
        }
    } else if (pixel === -1) {
        updateOutputImage()
        line.removeAttribute("style")
    }
}

function timeToString(ms, fullLength) {
    // Has plural support for full lengths
    if (fullLength) {
        if (ms < 1000) {
            return Math.floor(ms) + (ms === 1 ? " millisecond" : " milliseconds")
        } else if (ms < 60000) {
            return (ms * 0.001).toFixed(2) + " seconds"
        } else if (ms < 3600000) {
            var m = Math.floor(ms / 60000)
            var s = Math.floor(ms * 0.001 % 60)
            return (m === 1 ? "1 minute and " : m + " minutes and ") + (s === 1 ? "1 second" : s + " seconds")
        } else {
            var h = Math.floor(ms / 3600000)
            var m = Math.floor(ms / 60000 % 60)
            var s = Math.floor(ms * 0.001 % 60)
            return (h === 1 ? "1 hour, " : h + " hours, ") + (m === 1 ? "1 minute, and " : m + " minutes, and ") + (s === 1 ? "1 second" : s + " seconds")
        }
    } else {
        if (ms < 1000) {
            return Math.floor(ms) + "ms"
        } else if (ms < 60000) {
            return (ms * 0.001).toFixed(2) + "s"
        } else if (ms < 3600000) {
            return Math.floor(ms / 60000) + "m " + Math.floor(ms * 0.001 % 60) + "s"
        } else {
            return Math.floor(ms / 3600000) + "h " + Math.floor(ms / 60000 % 60) + "m " + Math.floor(ms * 0.001 % 60) + "s"
        }
    }
}

var scrollMultiplier = 1.1
var zoomX = 0, zoomY = 0, zx = 0, zy = 0
var zoomM = 1
var doZoom = false
var mouseDown = false
var currentX = -1
var currentY = -1
var pinching = false
var pinchDist = 0
var touchDown = false
var clickTime = 0, touchTime = 0, zoomTime = Infinity

document.addEventListener("mousedown", function (e) {
    hideCopy()
    // Double click events act strange in some browsers, so we use this instead.
    if (e.button === 0 && e.target === canvas || e.target === percent) {
        // If we set the click time to zero, then this statement becomes false.
        var newX = Math.round(e.clientX * devicePixelRatio * aliasingFactor)
        var newY = Math.round(e.clientY * devicePixelRatio * aliasingFactor)
        if (Date.now() - clickTime < 500 && newX === currentX && newY === currentY) {
            updateZoom(0.1, currentX, currentY)
            clickTime = 0
        } else {
            clickTime = Date.now()
        }
        currentX = newX
        currentY = newY
        mouseDown = true
    }
})

function retry(noClear) {
    unfinished = true
    rerender = true
    if (!noClear) {
        clearBack()
    }
    mainTime = performance.now()
}

function redo() {
    rehandle = true
    mainTime = performance.now()
}

function setPixel(num) {
    pixel = pixelItem[0] = num
}

function updateOutputImage() {
    imageDataBuffer.set(colorBytes)
    ctx.putImageData(imageData, 0, 0)
}

document.addEventListener("mousemove", function (e) {
    if (mouseDown) {
        var oldX = currentX
        var oldY = currentY
        currentX = Math.round(e.clientX * devicePixelRatio * aliasingFactor)
        currentY = Math.round(e.clientY * devicePixelRatio * aliasingFactor)
        diffX += currentX - oldX
        diffY += currentY - oldY
    } else if (!touchDown) {
        currentX = Math.round(e.clientX * devicePixelRatio * aliasingFactor)
        currentY = Math.round(e.clientY * devicePixelRatio * aliasingFactor)
    }
})

document.addEventListener("mouseup", function () {
    mouseDown = false
})

document.addEventListener("blur", function () {
    mouseDown = false
    // justSwitched = true
})

// Passive event weirdness
document.addEventListener("wheel", function (e) {
    if (e.ctrlKey) {
        e.preventDefault()
    }
    var target = e.target
    if (target === canvas || target === percent) {
        currentX = Math.round(e.clientX * devicePixelRatio * aliasingFactor)
        currentY = Math.round(e.clientY * devicePixelRatio * aliasingFactor)
        updateZoom(e.deltaY < 0 ? 1 / scrollMultiplier : scrollMultiplier, currentX, currentY)
    }
}, { passive: false })

function updateZoom(factor, x, y) {
    if (factor === 1) {
        return
    }
    var pointX = panX + x * zoom
    var pointY = panY + y * zoom
    zoom *= factor
    panX = pointX - x * zoom
    panY = pointY - y * zoom
    if (!isSafari) {
        var newTime = Date.now()
        if (zx !== x || zy !== y || newTime - zoomTime > 1000) {
            zoomM = factor
            zx = x
            zy = y
            ctx3.clearRect(0, 0, w, h)
            // This is faster than using putImageData(), so...we do it.
            ctx3.drawImage(canvas, 0, 0)
        } else {
            zoomM *= factor
        }
        zoomTime = newTime
    }
    zoomX = x * (1 - zoomM)
    zoomY = y * (1 - zoomM)
    doZoom = true
    redo()
}

function clearBack() {
    zoomM = 1
    if (needsClearing) {
        ctx2.clearRect(0, 0, w, h)
        ctx3.clearRect(0, 0, w, h)
        needsClearing = false
    }
}

var menuDisplayed = false

function toggleMenu() {
    if (menuDisplayed) {
        document.getElementById("menu").removeAttribute("style")
    } else {
        document.getElementById("menu").style.display = "block"
    }
    menuDisplayed = !menuDisplayed
}

function closeMenu() {
    document.getElementById("menu").removeAttribute("style")
    menuDisplayed = false
}

function resetLocation() {
    flowAmount = 0
    zoom = 0.004
    panX = (-w * 0.5 - 0.5) * zoom + 1e-5 - (fractalType === 1 || fractalType === 10 || fractalType === 14 ? 0.75 : fractalType === 7 || fractalType === 11 || fractalType === 12 || fractalType === 13 ? 0.5 : (fractalType === 8 ? 0.2 : 0))
    panY = (-h * 0.5 - 0.5) * zoom + 1e-5 + (fractalType === 7 ? -0.4 : (fractalType === 8 ? 0.25 : 0))
    clearBack()
}

function changeFractal(newType) {
    iterations = 1000
    previousGuess = 20000
    fractalType = newType
    resetLocation()
    redo()
}

function switchFractals() {
    changeFractal(fractalType === 16 ? 1 : fractalType + 1)
}

function colorButton(index, hue) {
    hue = Math.max(Math.min(hue, 1), 0)
    buttons[index].style.backgroundColor = hue === 1 ? "rgb(85, 200, 90)" : "rgb(" + Math.min(800 - hue * 700, 230) + "," + Math.floor(hue * 200) + ",60)"
}

function switchPallete() {
    if (palleteOverride) {
        palleteOverride = false
    } else {
        palleteID++
    }
    if (palleteID === totalPalletes) {
        palleteID = 0
    }
    flowAmount = 0
    pallete = palletes[palleteID]
    interior = interiors[palleteID]
    palleteLen = pallete.length - 1
    palleteData.set(pallete)
    requestRender()
}

function customizePallete() {
    var nextColors = decodePallete(newPallete.value.split(" "))
    if (nextColors !== false) {
        flowAmount = 0
        palleteOverride = true
        pallete = nextColors
        palleteLen = pallete.length - 1
        interior = 0xff000000 + pallete.pop()
        pallete.push(pallete[0])
        palleteData.set(pallete)
        clearBack()
        retry()
    }
}

const hexStr = "0123456789abcdef"
function decodePallete(colors) {
    var rgbLength = colors.length
    var newColors = Array(rgbLength)
    if (rgbLength < 2) {
        return false
    }
    for (var i = 0; i < rgbLength; i++) {
        var c = colors[i].trim()
        var split = c.split(",")
        if (split.length === 1) {
            var hex = null
            if (c.charCodeAt(0) === 35) {
                c = c.slice(1)
            }
            if (c.length === 6) {
                hex = (hexStr.indexOf(c[0]) << 4) + hexStr.indexOf(c[1]) + (hexStr.indexOf(c[2]) << 12) + (hexStr.indexOf(c[3]) << 8) + (hexStr.indexOf(c[4]) << 20) + (hexStr.indexOf(c[5]) << 16)
            } else if (c.length === 3) {
                hex = hexStr.indexOf(c[0]) * 17 + hexStr.indexOf(c[1]) * 4352 + hexStr.indexOf(c[1]) * 69632 // These may seem like magic numbers, but it's just converting #1bc, say, into #11bbcc.
            }
            if (!isFinite(hex)) {
                return false
            }
            newColors[i] = hex
            continue
        } else if (split.length !== 3) {
            return false
        }
        var textR = split[0]
        var textG = split[1]
        var textB = split[2]
        if (textR === "" || textG === "" || textB === "") {
            return false
        }
        var r = parseInt(textR)
        var g = parseInt(textG)
        var b = parseInt(textB)
        if (r >= 0 && r < 256 && g >= 0 && g < 256 && b >= 0 && g < 256) {
            newColors[i] = r + g * 256 + b * 65536
        } else {
            return false
        }
    }
    return newColors
}

function switchRenderMode(reverse) {
    if (reverse) {
        renderMode = renderMode === 0 ? 3 : renderMode - 1
    } else {
        renderMode = renderMode === 3 ? 0 : renderMode + 1
    }
    colorButton(2, renderMode * 0.35)
    requestRender()
}

function requestRender() {
    if (unfinished || flowRate === 0) {
        if (!unfinished) {
            needRender = true
        } else {
            retry()
        }
    }
}

function switchDarkenEffect() {
    changeDarkenEffect(darkenEffect === 3 ? 0 : darkenEffect + 1)
}

function changeDarkenEffect(newEffect) {
    var oldEffect = darkenEffect
    darkenEffect = newEffect
    colorButton(3, darkenEffect / 3)
    if ((oldEffect === 1 && darkenEffect === 2) || (oldEffect === 2 && darkenEffect === 1)) {
        requestRender()
    } else if (darkenEffect === 0) {
        getMemory(pixels, palleteBytes2 + pixels * 4, -32).fill(0) // Clear shading data
        retry()
    } else {
        redo()
        clearBack()
    }
}

function switchAliasMode() {
    var oldAlias = aliasingFactor
    aliasingFactor = aliasingFactor === 2 ? 1 : (aliasingFactor === 1 ? 1.1 : (aliasingFactor === 1.25 ? 2 : 1.25))
    zoom *= oldAlias / aliasingFactor
    needResize = 2
    colorButton(4, aliasingFactor * 3 - 3)
}

function switchFlow(rate) {
    flowRate = Math.min(10, Math.max(-10, flowRate + rate))
    colorButton(5, flowRate / 6 + 0.5)
    colorButton(6, -flowRate / 6 + 0.5)
}

function increaseSpeed() {
    if (speed < 25) {
        speed *= 1.15
        var color = Math.log10(speed) / 2.9 + 0.5
        colorButton(8, color)
        colorButton(9, 1 - color)
        requestRender()
    }
}

function decreaseSpeed() {
    if (speed > 0.01) {
        speed /= 1.15
        var color = 0.5 - Math.log10(1 / speed) * 0.25
        colorButton(8, color)
        colorButton(9, 1 - color)
        requestRender()
    }
}

function switchCategory() {
    if (fractalType < 7) {
        changeFractal(6)
    } else if (fractalType < 10) {
        changeFractal(9)
    } else {
        changeFractal(0)
    }
}

function setIterations(amount) {
    iterations = amount
    rehandle = true
    colorButton(11, Math.log10(iterations) * 0.25)
}

const fractalNames = [
    "None",
    "Mandelbrot set",
    "3rd Power Multibrot set",
    "4th Power Multibrot set",
    "5th Power Multibrot set",
    "6th Power Multibrot set",
    "7th Power Multibrot set",
    "Burning Ship",
    "3rd Power Burning Ship",
    "4th Power Burning Ship",
    "5th Power Burning Ship",
    "Celtic",
    "Perpendicular Mandelbrot",
    "Buffalo",
    "Tricorn",
    "9x Mandelbrot, 1x Burning Ship",
    "9x 3rd Power Multibrot, 1x 3rd Power Burning Ship",
    "9x 4th Power Multibrot, 1x 4th Power Burning Ship",
]
const shadingNames = [
    "Default",
    "Shadow",
    "Inverted Shadow",
    "Stripes"
]
function saveLocation() {
    var str
    if (juliaMode) {
        str = "X: " + panX + " Y: " + panY + " Zoom: " + (zoom * w) + " Type: " + fractalNames[fractalType] + " Julia Shading: " + shadingNames[darkenEffect] + " Julia X: " + juliaX + " Julia Y: " + juliaY
    } else {
        str = "X: " + panX + " Y: " + panY + " Zoom: " + (zoom * w) + " Type: " + fractalNames[fractalType] + " Shading: " + shadingNames[darkenEffect]
    }
    newLoc.value = str
}

function importLocation() {
    var val = newLoc.value.trim()
    var valA = val.indexOf("X:")
    var valB = val.indexOf(" Y:")
    var valC = val.indexOf(" Zoom:")
    var valD = val.indexOf(" Type:")
    var valE = val.indexOf(" Shading:")
    if (valA === 0 && valB !== -1 && valC !== -1 && valD !== -1 && valE !== -1) {
        var isJulia = false
        var a = val.slice(valA + 2, valB).trim()
        var b = val.slice(valB + 3, valC).trim()
        var c = val.slice(valC + 6, valD).trim()
        var e, f, g
        if (a !== "" && b !== "" && c !== "") {
            a = parseFloat(a)
            b = parseFloat(b)
            c = parseFloat(c)
            var fName = val.slice(valD + 6, valE).trim()
            if (fName.slice(-6) === " Julia") {
                var jx = val.indexOf(" Julia X:")
                var jy = val.indexOf(" Julia Y:")
                e = shadingNames.indexOf(val.slice(valE + 9, jx).trim())
                fName = fName.slice(0, fName.length - 6)
                f = val.slice(jx + 9, jy).trim()
                g = val.slice(jy + 9).trim()
                if (f !== "" && g !== "") {
                    f = parseFloat(f)
                    g = parseFloat(g)
                    isJulia = true
                } else {
                    return
                }
            } else {
                e = shadingNames.indexOf(val.slice(valE + 9).trim())
            }
            var d = fractalNames.indexOf(fName)
            if (isFinite(a) && isFinite(b) && c > 0 && isFinite(c) && c <= 0.5 && d !== -1 && d >= 1 && d < fractalNames.length && e >= 0 && e < shadingNames.length && (!isJulia || (isFinite(f) && isFinite(g)))) {
                if (panX !== a || panY !== b || zoom !== c || fractalType !== d || darkenEffect !== e) {
                    panX = a
                    panY = b
                    zoom = c / w
                    fractalType = d
                    darkenEffect = e
                    if (isJulia) {
                        juliaMode = true
                        juliaX = f
                        juliaY = g
                    }
                    redo()
                }
            }
        }
    }
}

var closeTimeout = -1
var rightClickX = 0
var rightClickY = 0
function onRightClick(e) {
    if (closeTimeout !== -1) {
        clearTimeout(closeTimeout)
        closeTimeout = -1
    }
    if (!juliaMode) {
        rightClickX = e.clientX
        rightClickY = e.clientY

        rightClick.style.visibility = "visible"
        rightClick.style.opacity = "1"
        rightClick.style.left = rightClickX + "px"
        rightClick.style.top = rightClickY + "px"
    }
    e.preventDefault()
}

function hideCopy() {
    rightClick.style.opacity = "0"
    closeTimeout = setTimeout(() => {
        rightClick.style.visibility = "hidden"
        closeTimeout = -1
    }, 500)
}

function completeResize() {
    resizeW = w
    resizeH = h
    resizeHandler()
    colorBytes.fill(0)
    if (needResize === 2) {
        redo()
    } else {
        updateZoom(Math.pow((resizeW * resizeW + resizeH * resizeH) / (w * w + h * h), 0.8), w * 0.5, h * 0.5)
    }
    needResize = false
}

window.addEventListener("resize", function () {
    needResize = true
})
canvas.addEventListener("contextmenu", onRightClick)
percent.addEventListener("contextmenu", onRightClick)
rightClick.addEventListener("contextmenu", onRightClick)

// function copyURL() {
//     navigator.clipboard.writeText(canvas.toDataURL("image/png", 1))
//     hideCopy()
// }

function makeIntoJulia() {
    juliaX = rightClickX * devicePixelRatio * zoom + panX
    juliaY = rightClickY * devicePixelRatio * zoom + panY
    juliaMode = true
    resetLocation()
    redo()
}

function download() {
    var a = document.createElement("a")
    a.download = "fractal.png"
    a.href = canvas.toDataURL("image/png", 1)
    document.body.appendChild(a)
    a.click()
    a.remove()
}

function reset() {
    clearBack()
    var oldZoom = zoom
    var oldX = panX
    var oldY = panY
    var oldSpeed = speed

    resetLocation()
    speed = 1
    colorButton(8, 0.5)
    colorButton(9, 0.5)
    if (juliaMode) {
        juliaX = 0
        juliaY = 0
        juliaMode = false
        redo()
    }
    if (oldZoom !== zoom || oldX !== panX || oldY !== panY || iterations !== 1000) {
        iterations = 1000
        previousGuess = 20000
        redo()
    } else if (oldSpeed !== speed) {
        retry()
    }
}

function loadInfo() {
    help.style.display = "unset"
}

// Color the buttons as needed
colorButton(2, renderMode * 0.35)
colorButton(3, darkenEffect / 3)
colorButton(4, aliasingFactor * 3 - 3)
colorButton(5, flowRate / 6 + 0.5)
colorButton(6, -flowRate / 6 + 0.5)
colorButton(8, 0.5)
colorButton(9, 0.5)
colorButton(11, Math.log10(iterations) * 0.25)
colorButton(12, pixelBreakdown)