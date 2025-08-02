"use strict"
// All the code and documentation is at https://github.com/plasma4/FractalSky; all code under AGPL v3, including the .cpp code used; main.js and worker.js are the JS sections.
const help = document.getElementById("help")
var useSharedWebWorkers = crossOriginIsolated
// Cross origin stuff is pretty weird
if (!window.WebAssembly || !WebAssembly.instantiateStreaming) {
    help.style.display = "unset"
    help.innerHTML = 'WebAssembly appears to be disabled currenly, so unfortunately, the program cannot function. Perhaps you are using a strict browser or have disabled it?<br><button onclick="help.removeAttribute(\'style\')" id="infoClose">Close</button>'
    throw new Error("WebAssembly is not supported. ):")
} else if (!useSharedWebWorkers) {
    document.getElementById("noteContent").innerHTML += "Unfortunately, this fractal viewer may only use a single core due to not supporting SharedArrayBuffer. " + (window.location.protocol === "file:" ? "This is probably happening because you are accessing this site from a file." : "You may have disabled shared web worker technology or not setup CORS headers properly; check the console log for more info.")
    console.warn("The fractal viewer will only use a single worker, as it normally uses SharedArrayBuffer to communicate between multiple workers and to allow the WebAssembly script to work using the same memory addresses. The Cross-Origin-Opener-Policy should be set to same-origin, and the Cross-Origin-Embedder-Policy should be set to require-corp. If you can't figure out how to do so, you can try to use an online web hoster that allows you to modify headers (say, with .htaccess) or use a properly set up localhost with updated headers. Check https://github.com/plasma4/FractalSky for info on how to set this up. Normally, https://fractalsky.netlify.app/ would work.")
}
// Set the timeout so there's no trace and so it takes up the most space
setTimeout(console.log, 4, "%cOpening the inspector could activate debugging components that can drag down the code significantly! If this does occur, reload the page after you've closed the inspector.", "font-family:'Gill Sans',Calibri,Tahoma;font-weight:600;font-size:15px")

window.addEventListener("load", function () {
    try {
        if (navigator.serviceWorker) {
            navigator.serviceWorker.register("serviceWorker.js")
                .then(() => {
                    console.log("Service Worker registered!")
                })
                .catch(e => {
                    console.warn("Service Worker registration failed:", e)
                })
        } else {
            console.warn("Service workers do not work!")
        }
    } catch (e) {
        console.error("Service Worker did not register:", e)
    }
})

// Helpful browser detection tools
const isFirefox = !!window.InternalError
const isSafari = !!window.GestureEvent

// Wake lock API possibly usable in the future:
function tryWakeLock() {
    if (navigator.wakeLock) {
        try {
            wakeLock = navigator.wakeLock.request("screen")
        } catch (e) {
            // Don't worry about it.
        }
    }
}

// M1: Linear sRGB to LMS
// Corresponds to the first matrix multiplication for l, m, s in linear_srgbToOklab()
const M1_LINEAR_SRGB_TO_LMS = [
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005]
]

// M2: LMS (non-linear) to Oklab
// Corresponds to the coefficients for L, a, b in the return of linear_srgbToOklab()
const M2_LMS_NON_LINEAR_TO_OKLAB = [
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660]
]

// M2_INVERSE: Oklab to LMS (non-linear)
// Corresponds to the coefficients for l_, m_, s_ in oklab_to_linear_srgb()
const M2_INVERSE_OKLAB_TO_LMS_NON_LINEAR = [
    [1.0, 0.3963377774, 0.2158037573],
    [1.0, -0.1055613458, -0.0638541728],
    [1.0, -0.0894841775, -1.2914855480]
]

// M1_INVERSE: LMS to Linear sRGB
// Corresponds to the coefficients for R, G, B in the return of oklab_to_linear_srgb()
const M1_INVERSE_LMS_TO_LINEAR_SRGB = [
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.7076147010]
]

/**
 * Helper function for matrix multiplication.
 * Multiplies a 3x3 matrix by a 3x1 vector.
 * @param {Array<Array<number>>} matrix - The 3x3 matrix.
 * @param {Array<number>} vector - The 3x1 vector.
 * @returns {Array<number>} The resulting 3x1 vector.
 */
function multiplyMatrixVector(matrix, vector) {
    const result = [0, 0, 0]
    for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 3; j++) {
            result[i] += matrix[i][j] * vector[j]
        }
    }
    return result
}

/**
 * Converts a packed sRGB number (e.g., 0xff0000) to an array [L, a, b] in Oklab space.
 * @param {number} srgb_packed - The sRGB color as a packed number (0xRRGGBB).
 * @returns {Array<number>} An array [L, a, b] representing the Oklab color.
 */
function srgbToOklab(srgb_packed) {
    // Unpack sRGB components (0-255)
    var r = ((srgb_packed >> 16) & 0xFF) / 255.0
    var g = ((srgb_packed >> 8) & 0xFF) / 255.0
    var b = (srgb_packed & 0xFF) / 255.0

    // Convert sRGB to linear sRGB
    // Standard sRGB EOTF (Electro-Optical Transfer Function)
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92

    // Convert linear sRGB to LMS (Long-Medium-Short) color space using M1_LINEAR_SRGB_TO_LMS
    const lmsLinear = multiplyMatrixVector(M1_LINEAR_SRGB_TO_LMS, [r, g, b])

    // Apply cube root non-linearity to LMS
    const lmsOklab = lmsLinear.map(val => Math.cbrt(val))

    // Convert LMS to Oklab (L, a, b) using M2_LMS_NON_LINEAR_TO_OKLAB
    const oklab = multiplyMatrixVector(M2_LMS_NON_LINEAR_TO_OKLAB, lmsOklab)
    return oklab
}

/**
 * Converts an array [L, a, b] in Oklab space back to a packed sRGB number.
 * @param {Array<number>} oklab_array - An array [L, a, b] representing the Oklab color.
 * @returns {number} The packed sRGB color number (0xRRGGBB).
 */
function oklabToSRGB(oklab_array) {
    const L = oklab_array[0]
    const a = oklab_array[1]
    const b = oklab_array[2]

    // Convert Oklab (L, a, b) to LMS (non-linear) using M2_INVERSE_OKLAB_TO_LMS_NON_LINEAR
    const lmsOklab = multiplyMatrixVector(M2_INVERSE_OKLAB_TO_LMS_NON_LINEAR, [L, a, b])

    // Undo cube root non-linearity to get linear LMS
    const lmsLinear = lmsOklab.map(val => val * val * val)

    // Convert linear LMS to linear sRGB using M1_INVERSE_LMS_TO_LINEAR_SRGB
    var [r_linear, g_linear, b_linear] = multiplyMatrixVector(M1_INVERSE_LMS_TO_LINEAR_SRGB, lmsLinear)

    // Convert linear sRGB to sRGB (gamma correction - OETF: Opto-Electronic Transfer Function)
    r_linear = r_linear > 0.0031308 ? (1.055 * Math.pow(r_linear, 1 / 2.4) - 0.055) : 12.92 * r_linear
    g_linear = g_linear > 0.0031308 ? (1.055 * Math.pow(g_linear, 1 / 2.4) - 0.055) : 12.92 * g_linear
    b_linear = b_linear > 0.0031308 ? (1.055 * Math.pow(b_linear, 1 / 2.4) - 0.055) : 12.92 * b_linear

    // Clamp values to [0, 1] and convert to 0-255 integer
    const R = Math.round(Math.max(0, Math.min(1, r_linear)) * 255)
    const G = Math.round(Math.max(0, Math.min(1, g_linear)) * 255)
    const B = Math.round(Math.max(0, Math.min(1, b_linear)) * 255)

    // Pack into a single 32-bit number in 0xRRGGBB format
    return ((R << 16) | (G << 8) | B) ^ 0xff000000
}

/**
 * Generates a lookup table for converting 8-bit sRGB values (0-255) to linear sRGB (0.0-1.0).
 * @returns {Float32Array} A 256-element array where index is sRGB value and value is linear sRGB.
 */
function generateSRGBLinearLUT() {
    const lut = new Float32Array(256)
    for (var i = 0; i < 256; i++) {
        const srgb_norm = i / 255.0
        lut[i] = srgb_norm > 0.04045 ? Math.pow((srgb_norm + 0.055) / 1.055, 2.4) : srgb_norm / 12.92
    }
    return lut
}

/**
 * Generates a lookup table for converting linear sRGB values (0.0-1.0, represented as 0-255 integer steps) to 8-bit sRGB (0-255).
 * @returns {Uint8Array} A 256-element array where index is linear sRGB step and value is 8-bit sRGB.
 */
function generateLinearSRGBLUT() {
    const lut = new Uint8Array(256)
    for (var i = 0; i < 256; i++) {
        const linear_norm = i / 255.0
        var srgb_val = linear_norm > 0.0031308 ? (1.055 * Math.pow(linear_norm, 1 / 2.4) - 0.055) : 12.92 * linear_norm
        lut[i] = Math.round(Math.max(0, Math.min(1, srgb_val)) * 255)
    }
    return lut
}

/**
 * Initializes color science data structures in provided memory.
 * This includes generating a mega-palette for smooth color transitions
 * and a shading lookup table for applying shade amounts to sRGB colors.
 *
 * @param {ArrayBuffer} memory An object containing an ArrayBuffer.
 * @param {number} paletteStart The byte offset in `memory.buffer` where the mega-palette should be written.
 * @param {number} shadingStart The byte offset in `memory.buffer` where the shading LUT should be written.
 * @param {Array<number>} originalPalette An array of packed sRGB numbers (0xRRGGBB) representing the base palette.
 * @returns {{megaPaletteSize: number}} An object containing the size of the generated mega-palette.
 */
function initializeColorScience(memory, highResSteps, paletteStart, shadingStart, originalPalette) {
    // Generate sRGB <-> Linear sRGB LUTs once
    const srgbToLinearLUT = generateSRGBLinearLUT()
    const linearToSrgbLUT = generateLinearSRGBLUT()

    // originalPalette.length - 1 because we interpolate between N colors, meaning N-1 segments.
    // If originalPalette has 2 colors, there's 1 segment. If it has 10 colors, there are 9 segments.
    const originalPaletteSegments = originalPalette.length - 1
    const finalLUTLength = originalPaletteSegments * highResSteps
    const megaPalette = new Uint32Array(finalLUTLength)

    for (var i = 0; i < originalPaletteSegments; i++) {
        const oklab1 = srgbToOklab(originalPalette[i])
        const oklab2 = srgbToOklab(originalPalette[i + 1])
        for (var j = 0; j < highResSteps; j++) {
            const fraction = j / (highResSteps - 1)
            const interpolated_oklab = [
                oklab1[0] * (1 - fraction) + oklab2[0] * fraction,
                oklab1[1] * (1 - fraction) + oklab2[1] * fraction,
                oklab1[2] * (1 - fraction) + oklab2[2] * fraction
            ]
            megaPalette[i * highResSteps + j] = oklabToSRGB(interpolated_oklab)
        }
    }

    // Write the megaPalette to the shared memory buffer
    new Uint32Array(memory.buffer, paletteStart, finalLUTLength).set(megaPalette)

    const numShades = 256
    const shadingLUT = new Uint8Array(256 * numShades) // 256 original values * 256 shade amounts
    for (var originalValue = 0; originalValue < 256; originalValue++) {
        // Get the linear representation of the original sRGB 8-bit value
        const linearValue = srgbToLinearLUT[originalValue]
        for (var shadeAmount = 0; shadeAmount < numShades; shadeAmount++) {
            const shadeFraction = 1 - (shadeAmount / 255) // 0 (full shade) to 1 (no shade)
            const shadedLinearValue = linearValue * shadeFraction

            // Convert the shaded linear value back to an 8-bit sRGB value using the LUT
            // We multiply by 255 and round to get the appropriate index for linearToSrgbLUT
            const finalSrgbValue = linearToSrgbLUT[Math.round(Math.max(0, Math.min(1, shadedLinearValue)) * 255)]

            shadingLUT[originalValue * numShades + shadeAmount] = finalSrgbValue
        }
    }

    // Write the shadingLUT to the shared memory buffer
    new Uint8Array(memory.buffer, shadingStart, shadingLUT.length).set(shadingLUT)
}

function parseGracefulUrlParams(url) {
    var parsedUrl = new URL(url)
    var searchPart = parsedUrl.search

    // If there's only one question mark, URLSearchParams works perfectly
    if (searchPart.indexOf("?") === searchPart.lastIndexOf("?")) {
        return new URLSearchParams(searchPart)
    }

    var parts = searchPart.substring(1).split("?") // Remove leading question mark
    var combinedQueryString = ""

    if (parts.length > 0) {
        combinedQueryString = parts[0]

        for (var i = 1; i < parts.length; i++) {
            combinedQueryString += "&" + parts[i]
        }
    }

    // Now, create a URLSearchParams object from the "corrected" string
    return new URLSearchParams(combinedQueryString)
}

const buttons = Array.from(document.getElementsByTagName("button")).slice(2)
const rightClick = document.getElementById("rightClick")
const notice = document.getElementById("notice")
const line = document.getElementById("line")
const sheet = document.getElementById("sheet")
const select = document.getElementById("select")
const canvas = document.getElementById("canvas")
const ctx = canvas.getContext("2d", { willReadFrequently: false }) // Some browsers are stinky and get mad after several fast getImageData calls which happen on resize. (Although this doesn't seem to do anything.)
const previous = document.getElementById("previous")
const ctx2 = previous.getContext("2d")
const hidden = document.createElement("canvas")
const ctx3 = hidden.getContext("2d")
const percent = document.getElementById("percent")
const welcome = document.getElementById("welcome")
const newPalette = document.getElementById("newPalette")

// Names for exporting/importing
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

var urlParameters = parseGracefulUrlParams(location)
const workerCount = useSharedWebWorkers ? urlParameters.get("workers") ? +urlParameters.get("workers") : navigator.hardwareConcurrency : 1
document.getElementById("hardwareWorkers").textContent = navigator.hardwareConcurrency + (navigator.hardwareConcurrency === 1 ? " worker" : " workers") + (workerCount !== navigator.hardwareConcurrency ? " (overridden to " + workerCount + ")" : "")
// Be very careful to not rename or remove this line when using tasks.json! This caused me several hours of headache... ):
const unsharedWASMData = "data:application/wasm;base64,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"
var w, h, colorDataStart, wasmLength, dataArray, colorBytes, dataBits, paletteData, colorArray, pixelItem

// Notes for the welcome popup
if (isSafari) {
    notice.textContent = "IMPORTANT: Safari is significantly slower for this program than other browsers, and misses out on a few minor features. Try using a browser like Firefox or Chrome to get the best speed and performance."
}

function updateProgressLine(currentPixel) {
    if (currentPixel === -1 || currentPixel >= pixels) {
        line.removeAttribute("style")
        return
    }

    const pixelDiff = Math.round((currentPixel - originalPixel) * 0.01)
    let color
    if (pixelDiff >= 768) {
        const brightness = Math.min(255, (pixelDiff >> 2) - 768)
        color = "rgb(" + brightness + ",255," + brightness + ")"
    } else if (pixelDiff < 256) {
        color = "rgb(255," + pixelDiff + ",0)"
    } else {
        color = "rgb(" + ((pixelDiff - 256) >> 1) + ",255,0)"
    }

    // Update the line's visual style immediately.
    line.style.top = (Math.floor(currentPixel / w) / devicePixelRatio).toFixed(1) + "px"
    line.style.backgroundColor = color
}

/**
 * This simulates a Web Worker's API when SharedArrayBuffer is not available.
 * It runs WebAssembly operations directly in the main thread.
 */
function FakeWorker() {
    this.workerID = -1
    this.memory = null
    this.handlePixels = null
    this.handleRender = null
    this._mainThreadOnMessage = null
    this._isSetup = false
    this.wasmFileName = unsharedWASMData
}

/**
 * Sets the function that will receive messages from this simulated worker.
 */
Object.defineProperty(FakeWorker.prototype, "onmessage", {
    set: function (func) {
        this._mainThreadOnMessage = func
    },
    enumerable: true,
    configurable: true
})

/**
 * Simulates sending a message from the main script to this worker.
 */
FakeWorker.prototype.postMessage = function (data) {
    if (data.id != null) {
        this.workerID = data.id
    }

    if (data.mem != null) {
        this.memory = data.mem // Expects a WebAssembly.Memory object

        if (!this._isSetup) {
            this.setupWorker()
            this._isSetup = true
        }
    } else if (Array.isArray(data) && typeof data[0] === "number") {
        // Execute the WASM functions involved
        const sliced = data.slice(1)
        let result = null
        if (data[0] === 1 && this.handlePixels) {
            result = this.handlePixels.apply(this, sliced)
        } else if (data[0] === 2 && this.handleRender) {
            result = this.handleRender.apply(this, sliced)
        }

        // Defer posting the message to simulate asynchronicity, and allow performance.now() to work properly!
        setTimeout(() => {
            this._postMessageFromWorker(result)
        }, 0)
    }
}

/**
 * Simulates the worker sending a message back to the main thread.
 */
FakeWorker.prototype._postMessageFromWorker = function (data) {
    if (this._mainThreadOnMessage) {
        this._mainThreadOnMessage({ data: data })
    }
}

/**
 * Initializes the WebAssembly module.
 */
FakeWorker.prototype.setupWorker = function () {
    if (!window.WebAssembly || !WebAssembly.instantiateStreaming) {
        console.error("FakeWorker: WebAssembly is not supported, cannot instantiate WASM module.")
    }

    WebAssembly.instantiateStreaming(fetch(this.wasmFileName), { // Use the provided WASM file name
        env: {
            memory: this.memory
        }
    }).then(result => {
        this.handlePixels = result.instance.exports.run
        this.handleRender = result.instance.exports.render
        setTimeout(() => this._postMessageFromWorker(-2), 0)
    }).catch(e => {
        console.error("FakeWorker: Error instantiating WASM module:", e)
    })
}

/**
 * Gets the ArrayBuffer backing the WebAssembly.Memory.
 */
Object.defineProperty(FakeWorker.prototype, "buffer", {
    get: function () {
        return this.memory ? this.memory.buffer : null
    },
    enumerable: true,
    configurable: true
})

/**
 * Mimics WebAssembly.Memory.grow().
 */
FakeWorker.prototype.grow = function (pages) {
    if (this.memory) {
        try {
            this.memory.grow(pages)
        } catch (e) {
            help.style.display = "unset"
            help.innerHTML = 'Unfortunately, an error occured while adding more memory. This may be because of default memory limitations; try adding ?maxMB=4096 to the start of the URL (no commas in the number), or check the console if that doesn\'t work. Press Close and export and copy the current fractal position if needed.<br><button onclick="help.removeAttribute(\'style\')" id="infoClose">Close</button>'
            throw e
        }
    }
}

function messageWebWorkersObject(message) {
    for (var i = 0; i < webWorkers.length; i++) {
        message.id = i
        webWorkers[i].postMessage(message)
    }
}

function messageWebWorker(i, message) {
    webWorkers[i].postMessage(message)
}

// Giant tables of color values (in hexadecimal)
const palettes = [
    [0x0a0aa0, 0x3232ff, 0x00c8ff, 0x00b43c, 0xdcb428, 0x7d643c, 0xdcc8c8, 0xc864aa, 0x820a8c, 0x7d00b9, 0x375ff5, 0x14a0e6, 0x5fe1dc, 0x8ce1c8, 0x9bc87d, 0xf08750, 0xe650aa, 0xa564f0],
    [0xf7c3f1, 0xe7ece9, 0xc8b2af, 0x181519, 0xbfaaae, 0xcac7ca, 0xc9afb3, 0x424141, 0xd1aead, 0xe9e7ea, 0xd0acb4, 0x171516, 0xc59b8e, 0xc4c4c4, 0xc18477, 0x444645, 0xc3995b, 0xeceae7, 0xbcb346, 0x1a1b1b, 0xe3ae54, 0xd0d1cf, 0xcfb6b1, 0x37373b, 0xc8afb1, 0xeaebe7, 0xc0afaf, 0x141415, 0xc2afa8, 0xc7ccca, 0xc2b2ae, 0x403c41, 0xcdb6b1, 0xe6eceb, 0xc6b2bc, 0x151516, 0xc7a9bb, 0xc4c7c4, 0xc992c6, 0x4b4b45, 0xcda2af, 0xe9ebea, 0xc5b3af, 0x1a1419, 0xd6ad97, 0xd4d3d5, 0xd19866, 0x3e393d, 0xd7732e, 0xebe8ec, 0xd29f56, 0x151615, 0xbeb5a9, 0xc4c9ca, 0xc5b8a4, 0x3e4141, 0xc4b6a9, 0xeae6e5, 0xc7bb59, 0x191414, 0xccb979, 0xc7c7c5, 0xbcb0a3, 0x433f42, 0xb5b05b, 0xece5e9, 0xbdb660, 0x161518, 0xc2bb51, 0xd3d9d9, 0xc1bd56, 0x494444, 0xbfbc59, 0xe5e5e5, 0x7f7c3d, 0x1a1919, 0x9e9e47, 0xc3c1c4, 0xc3994c, 0x2e322f, 0xc67f44, 0xe6ebea, 0xc88c7b, 0x151b19, 0xca5693, 0xc6c6c6, 0xc4529d, 0x4f4c4e, 0xb87b8a, 0xe9eceb, 0xaf6d59, 0x1b1b14, 0xbcc054, 0xd6d7d7, 0xb7bf43, 0x3b3535, 0xb4ba55, 0xe6e8ec, 0xb1b952, 0x171817, 0xafb650, 0xc3c1c5, 0xb4c04c, 0x373539, 0xb7c444, 0xe7e9ec, 0xbaa466, 0x191a1a, 0x844435, 0xc8c9c5, 0xd2657a, 0x4d4b4d, 0xbe9e50, 0xe5e7e7, 0xb3bc3d, 0x1b1915, 0xb1be48, 0xd0d2d6, 0xb2c03a, 0x362f35, 0xb1bc47, 0xe7ece5, 0xb0b753, 0x141517, 0x93b94e, 0xc7c9c9, 0x519f03, 0x3d3e43, 0xb3c73d, 0xeaeceb, 0xadc638, 0x181b17, 0xa9c24f, 0xcacbc9, 0x7ebb6b, 0x484948, 0x4ac484, 0xe9e5ec, 0x6fa65f, 0x1a1916, 0xb5c445, 0xd5ced1, 0xb0c548, 0x3c3638, 0xaabf3d, 0xece5e8, 0xb0b74f, 0x19171b, 0xafb948, 0xc9c5ca, 0xaac140, 0x3d3e43, 0xafc13f, 0xe8e5e6, 0xacc234, 0x141416, 0xafc14e, 0xc3c4c2, 0xadbb4f, 0x474747, 0xb1bc4c, 0xe5ebe5, 0x757a2a, 0x151716, 0x393e13, 0xd7d4d3, 0x2d873b, 0x3f3e39, 0x3eaf57, 0xe9e6e9, 0x66b668, 0x141816, 0x9cba4f, 0xc8cbc9, 0xadbf44, 0x3c3d40, 0xb7bc47, 0xeae7e5, 0x68bc39, 0x191917, 0x68c838, 0xc2c3c3, 0xacc559, 0x404645, 0xafb049, 0xeae7ec, 0xb0b552, 0x191914, 0xb0bb3f, 0xd7d3d4, 0xb7b84a, 0x434a43, 0xb6b44f, 0xe5e5ea, 0x98b54e, 0x14181b, 0x55b163, 0xc1c1c6, 0x009800, 0x2c322c, 0x42763d, 0xe8e7e6, 0x64b346, 0x181b15, 0x41c04e, 0xc8c6c7, 0xb6ae5a, 0x524c52, 0xb1b050, 0xeae8e7, 0xb6aa55, 0x141515, 0xb9ad53, 0xd6dad7, 0xbba242, 0x393535, 0xc08d4b, 0xeaeaeb, 0xb65d53, 0x1b181a, 0xb69551, 0xc4c4c4, 0xbaa556, 0x3a353a, 0xbb594f, 0xeae5ec, 0xc27658, 0x181616, 0xbd5756, 0xcacbca, 0xb75d5c, 0x4b4d4e, 0xb75a5a, 0xeae9e9, 0xc05c8b, 0x181b17, 0xcc5cad, 0xd1d0ce, 0xb77bba, 0x353734, 0xc464c5, 0xe9e6e6, 0xb957aa, 0x181515, 0xc45086, 0xc9c5c6, 0xbd56a8, 0x424042, 0xde86ad, 0xe9e5ea, 0xd26899, 0x161b19, 0xb94eb2, 0xc6cbc4, 0x9d67cf, 0x4d464b, 0xb759aa, 0xe6eae9, 0xca6ba7, 0x15171a, 0xc045a1, 0xcfd4d0, 0xc44ba6, 0x393935, 0xc23f7d, 0xe9e7e9, 0xbc53a6, 0x151a18, 0xa540c0, 0xc9c7c6, 0xbd46a4, 0x3f3d43, 0xc846a7, 0xebebea, 0xdb57ce, 0x161518, 0xa858c8, 0xc7c7c5, 0x6b3fca, 0x454a47, 0xb054a7, 0xe9eae8, 0xd176ba, 0x1a181a, 0xca2cb6, 0xd6d8d7, 0xc543a6, 0x403d3c, 0xb24f8c, 0xe6e7ec, 0xb849a9, 0x19171b, 0xb950a8, 0xcac5c9, 0xbf45aa, 0x3e3e3b, 0xc749a9, 0xe5e6e7, 0xc833a1, 0x161419, 0xc03c81, 0xc4c5c1, 0xc33d55, 0x3f4246, 0xdc9942, 0xe6e8e5, 0xb7bd66, 0x171a18, 0xcf8d52, 0xdad5da, 0xc944a8, 0x494549, 0xc34ca9, 0xe9e8e7, 0x9b41bd, 0x181514, 0x8f45ca, 0xc2c1c5, 0xb239c6, 0x2c322f, 0xbd3dc4, 0xebe8ec, 0xca45ae, 0x18161a, 0xc742a6, 0xc3c7c5, 0xb959aa, 0x4c534f, 0xc04eaf, 0xe9eae7, 0xcb34b7, 0x191416, 0x9d1e9f, 0xd8d8d4, 0x791e96, 0x373833, 0x5f1abb, 0xece8ec, 0x9a39dc, 0x161714, 0xa776e0, 0xeceaeb, 0x99abf6, 0x3c3837, 0x76cdf3, 0xe7e9e7, 0x5b95dc, 0x1a1417, 0x5452cd, 0xdfe3e3, 0x7225bc, 0x4c4e4a, 0xb34acb, 0xe8e7eb, 0xc845b3, 0x1b141b, 0xcc51b3, 0xd1d4d4, 0xca4ab7, 0x323433, 0xc452b4, 0xece7e5, 0xbe5cb8, 0x141814, 0xa73c97, 0xc5c9c7, 0x96498c, 0x3a3e3c, 0x81347e, 0xe6e9e9, 0x5e3660, 0x161817, 0x934986, 0xc4c6c4, 0xc255b9, 0x4e4747, 0xbba3b4, 0xe9ece9, 0xc55abe, 0x1b1814, 0xdc91d2, 0xd2d1ce, 0xcd5bc3, 0x393232, 0xcb58bb, 0xebeae9, 0xbfa6b5, 0x151519, 0xc45bb8, 0xcbcbca, 0xc85abc, 0x42403f, 0xcaa3c1, 0xeae6eb, 0xd157c6, 0x151516, 0xd49bca, 0xc4c2c4, 0xc1a3bc, 0x464143, 0xd498c8, 0xe6e5e9, 0xc6a5bf, 0x141a19, 0xe5ace3, 0xd7d6d4, 0xcba6c5, 0x403d3c, 0xcda6c6, 0xe8e7e7, 0xc5a6bf, 0x161716, 0xbeabbd, 0xc4c5c9, 0xcca7c5, 0x3c3e3a, 0xcca9c6, 0xe8e9ec, 0xcb88cb, 0x17181a, 0xb62fb4, 0xc1c2c0, 0xa470bf, 0x454043, 0xc4a8be, 0xe5e7e7, 0xc8aec6, 0x161617, 0xcfabd1, 0xd8d3d5, 0x9d6bcc, 0x454442, 0xd9a6ee, 0xe6ece9, 0xcba1c7, 0x181a18, 0xc288c9, 0xc1c3c7, 0xcbaac6, 0x333333, 0xd0a8cb, 0xe7e9e7, 0xcfb0cf, 0x141a18, 0xc9adcc, 0xcac5c7, 0xc0adbe, 0x53524d, 0xc1acbf, 0xe5e9e8, 0xdb9ccc, 0x141914, 0xd3aad0, 0xd5dbd7, 0x9983cf, 0x363a34, 0x8a70d2, 0xece7ec, 0x6297ec, 0x161419, 0x68c9e2, 0xedeff4, 0x46cc8c, 0x373d39, 0x93ce3f, 0xe5e6eb, 0xcac25c, 0x151415, 0xd4aa4b, 0xdce1db, 0xe27eda, 0x4d4a4b, 0xc999cb, 0xe6ecea, 0xc7a8cc, 0x19161a, 0xccafc8, 0xcfced3, 0xc7a7d2, 0x373539, 0xbfb0cb, 0xeae9e6, 0xbeaabe, 0x171a17, 0xbaa4be, 0xc6c4ca, 0xbca9c4, 0x3d403b, 0xc6a9cf, 0xe6e9e9, 0xc8aad1, 0x181915, 0xbeaac9, 0xcac4cb, 0xbda4c5, 0x4a4b4f, 0xb7abc2, 0xe8e9e7, 0xbeabc9, 0x1a1b19, 0xc4a9d2, 0xced2d1, 0xc1abce, 0x303736, 0xb9a9c8, 0xeae7e7, 0xb8aabc, 0x18141a, 0xb2a3c3, 0xc8c7c9, 0xb5a6c5, 0x444344, 0x967dc0, 0xebe5e8, 0x9574ec, 0x191a14, 0x9d85e4, 0xc6c6c2, 0xa38ec5, 0x424540, 0xb2a3c4, 0xe5e7e8, 0xb7a6c8, 0x161b17, 0xc1aec8, 0xd5d8d4, 0xb2a6cb, 0x42413e, 0xb3aac7, 0xe5ebe9, 0xb1a7c1, 0x191816, 0xafaac2, 0xcac8c6, 0xaea6ca, 0x3a3f39, 0xb3a8cc, 0xece5e6, 0xc4a7cf, 0x1a1b19, 0xd898cd, 0xc3c4c2, 0xcd8fc1, 0x414341, 0xdd81bf, 0xece9ec, 0xda61b2, 0x151818, 0xe590d8, 0xd9d7d5, 0xb1a6cf, 0x444340, 0xaca7cb, 0xe5e5ec, 0xaaa9c6, 0x181519, 0xa6a4bd, 0xc6c2c0, 0xa3a4cd, 0x2c2f2f, 0xa4a6d1, 0xece5e7, 0xa7accc, 0x1b1915, 0xaaa6c7, 0xcac5c7, 0xa9aec3, 0x514f50, 0xa5a4c7, 0xeceae6, 0xa4a5cc, 0x1b1418, 0xa7a4ce, 0xdadbda, 0x969ac9, 0x3a3b34, 0xb6b2ea, 0xeceaeb, 0x97b7ee, 0x1b1a1a, 0x72b8e9, 0xe2e1e3, 0xa6adca, 0x383b36, 0xa5a2ce, 0xece6ec, 0xa6a6ce, 0x19171a, 0xa5a6c7, 0xcbc6c8, 0xaaa8be, 0x4a4b4b, 0xa8a7c1, 0xeaeaeb, 0x99a8eb, 0x171415, 0x8d94ed, 0xd1ced2, 0x79c5ec, 0x363535, 0x7aa7eb, 0xece7eb, 0x98a2d3, 0x141415, 0xa8a8c4, 0xcdd0d1, 0xaaa4c7, 0x3c3d3f, 0x9c96df, 0xeceae8, 0xa8a4ca, 0x1a1417, 0xa6a8c6, 0xcbc6c9, 0xa8a5bc, 0x4f504c, 0xaeaebb, 0xece7e9, 0xa8a6c6, 0x171b17, 0xa9aaca, 0xd5d0d2, 0xa7a4c7, 0x323135, 0xb491d6, 0xece5e7, 0xac80d6, 0x14151a, 0xbf6cd9, 0xc9c7ca, 0x956de0, 0x454545, 0x7e7ced, 0xe5e8eb, 0xa3a5bd, 0x151917, 0x8e83af, 0xd9d7d5, 0xaaa3b2, 0x433f3e, 0xa7a3b4, 0xe9eae9, 0xaca6b3, 0x181414, 0xa2a6c2, 0xd7d9d5, 0xb2a5b3, 0x423e3d, 0xaca7b5, 0xe7e9e7, 0xaca4ae, 0x151616, 0xaca7b1, 0xcbc5c4, 0x918ebd, 0x3a3b3c, 0xb2a6b0, 0xeae7ea, 0xd4b1d3, 0x1b161b, 0xcb98c6, 0xc3c1c1, 0xe5c7ee, 0x474644, 0xae88df, 0xeae8ea, 0xae61dd, 0x19181b, 0xb45da3, 0xd7d5d9, 0xc94b6e, 0x423f3f, 0xd2a188, 0xece9e7, 0xd28339, 0x161b1a, 0xc5a04b, 0xc6c4c3, 0xc17644, 0x2f2f33, 0xb55e51, 0xebe9e9, 0xc3984c, 0x171614, 0xae9d2e, 0xc5c7c7, 0xb6a660, 0x514e4e, 0xb0a556, 0xeaecea, 0xbe884e, 0x141914, 0xc46e3b, 0xdad4d7, 0xb58a43, 0x35343a, 0xb9a557, 0xe9ece5, 0xb6a355, 0x15161a, 0xb7a657, 0xc7c4c3, 0xb9a957, 0x36363b, 0xc5b037, 0xeae5e6, 0xbca54c, 0x171517, 0xb45b48, 0xcbcacb, 0xb05e51, 0x4c4b49, 0xb3a74e, 0xeae9e5, 0xb85d42, 0x171916, 0xb9a449, 0xd0d3d2, 0xbc5942, 0x393638, 0xbaa44b, 0xeae7e6, 0xb7a653, 0x161a19, 0xb45b45, 0xc4c3c7, 0xb7a149, 0x383d3f, 0xbb5939, 0xecece7, 0xb85840, 0x18181a, 0xb9a44e, 0xc4c6c9, 0xb2604c, 0x4a4f4e, 0xb9ab53, 0xeae9e9, 0xb55943, 0x141917, 0xb95d43, 0xd4d5d5, 0xb65741, 0x302f33, 0xb85740, 0xe7eaeb, 0xb5a551, 0x181917, 0xb05b50, 0xc9c5ca, 0xb5a64b, 0x444647, 0xb9a547, 0xeae5ea, 0xbb5d3f, 0x161516, 0xb5a852, 0xc4c6c4, 0xb15b4b, 0x434043, 0xb05e50, 0xe5e9eb, 0xb9a64b, 0x181b19, 0xba5c44, 0xd2d8d6, 0xb9a64f, 0x454445, 0xb6a04c, 0xe8e8e6, 0xb3a557, 0x191619, 0xb4a55a, 0xcac4c9, 0xaf5a4e, 0x36353a, 0xb9a954, 0xe6eaea, 0xb1564e, 0x141818, 0xb5a857, 0xc5c1c5, 0xafa35d, 0x454849, 0xb4a459, 0xe8ebe9, 0xc3b397, 0x141b14, 0xafa85a, 0xd8d6d7, 0xb3a35c, 0x43443f, 0xb3c15c, 0xe6e5e6, 0x9cd083, 0x17161b, 0x5abb50, 0xc3c4c2, 0xd2cb4c, 0x322f32], // this was NOT manually done; don't worry
    [0xc8c8ff, 0x4cdbff, 0x692d7, 0x122c91, 0x371663, 0x600d39, 0x8a030f, 0xbf2600, 0xfb6200, 0xffc9a6, 0x000000]
]
const interiors = [0xff000000, 0xff000000, 0xff000000, 0xffffffff]
const totalPalettes = palettes.length

function setupPalettes() {
    // Constants can be modified with push(), so this is quite all right.
    for (var i = 0; i !== totalPalettes; i++) {
        var palette = palettes[i]
        // Add transparency values
        var start = palette[0] ^ 0xff000000
        palette[0] = start
        palette.push(start)
    }
}

setupPalettes()

var paletteOverride = false
var paletteID = 0
var palette = palettes[paletteID]
var interior = interiors[0]
var paletteLen = palette.length - 1

var pixels = Math.round(innerWidth * devicePixelRatio) * Math.round(innerHeight * devicePixelRatio)
var flowRate = 0, flowAmount = 0
var resizeW, resizeH

var imageData, imageDataBuffer

// To ensure that the site works properly, make sure this value is a multiple of 8 if you want to change it.
const paletteStart = 65536 + 32 // Atomic counter, limb counter, job ID, palette data, then a blank for SIMD alignment
const paletteBytes = 100000
const decimalStart = paletteBytes + paletteStart // Used for Decimal values
const dataStart = decimalStart + 4096
const defaultCost = 200000
var wasmLength = pixels * 12 + dataStart
var webWorkers = []
var workersDone = 0
var calculationDiff = 1
var highestProgress = 0
var rendersComp
var needResize = false
var needRender = false
var workerCosts = []
var workerResults = []

var memory, buffer
function setupWebWorkers(amount) {
    for (let i = 0; i < amount; i++) {
        var worker
        if (useSharedWebWorkers) {
            worker = new Worker("worker.js")
        } else {
            // amount will equal 1 when using a FakeWorker
            worker = new FakeWorker()
            const fakeWorkerUpdateLoop = () => {
                updateProgressLine(pixel) // Update the line with the latest known value
                if (unfinished) {
                    requestAnimationFrame(fakeWorkerUpdateLoop)
                }
            }
            requestAnimationFrame(fakeWorkerUpdateLoop)
        }

        var max = urlParameters.get("maxMB") * 16
        if (max > 4096) {
            console.warn("The maximum amount of memory possible is 4096 MB, so it has been set to that.")
            max = 4096
        }
        try {
            memory = new WebAssembly.Memory({
                initial: Math.ceil(wasmLength / 65536),
                maximum: max ? max : 20000, // 1,250 MB default
                shared: useSharedWebWorkers
            })
        } catch (e) {
            help.style.display = "unset"
            help.innerHTML = 'Unfortunately, an error occured while creating the memory. This may be because of default memory limitations; try adding ?maxMB=4096 to the start of the URL (no commas in the number), or check the console if that doesn\'t work.<br><button onclick="help.removeAttribute(\'style\')" id="infoClose">Close</button>'
            throw e
        }
        buffer = memory.buffer

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
                return
            }

            workerResults[i] = data
            if (data != null && data !== -1) {
                // Use some easing/adjustment for cost
                workerCosts[i] = 0.9 * workerCosts[i] + Math.max(Math.min(wantedFPS * ((workerCosts[i] + 5000) / (calculationDiff + 1)), workerCosts[i] * 0.25), 5000)
            }

            if (++workersDone === workerCount) {
                workersDone = 0
                var newTime = performance.now()
                calculationDiff = Math.max(newTime - time, 1)
                time = newTime

                if (workerResults.some(res => res != null && res !== -1)) {
                    for (let t = 0; t < workerCount; t++) {
                        workerCosts[t] = 0.9 * workerCosts[t] + Math.max(Math.min(wantedFPS * ((workerCosts[t] + 5000) / (calculationDiff + 1)), workerCosts[t] * 0.25), 5000)
                    }
                }

                if (data == null) {
                    // Using the optimized render function returns a void, so we check if that's the case here.
                    requestAnimationFrame(function () {
                        update()
                        completeRender(true)
                    })
                } else {
                    updateOutputImage()
                    lastOutput = performance.now()
                    var finalResultsThisPass = workerResults.slice(0)
                    workerResults.fill(null)

                    var progressValues = finalResultsThisPass.filter(val => val !== -1 && val != null)
                    highestProgress = progressValues.length > 0 ? Math.max(...progressValues) : -1
                    var lowestProgress = progressValues.length > 0 ? Math.min(...progressValues) : -1

                    pixel = lowestProgress >= pixels ? -1 : lowestProgress
                    pixelDiff = Math.round((pixel - originalPixel) * 0.01)
                    unfinished = pixel !== -1

                    update()
                    requestAnimationFrame(completeRender)
                }
            }
        }
        webWorkers.push(worker)
        workerResults.push(0)
        workerCosts.push(defaultCost)
    }
}

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
messageWebWorkersObject({ mem: memory })

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
                    switchShadingEffect()
                } else if (code === 73) {
                    setIterations(iterations + 250)
                } else if (code === 77) {
                    switchRenderMode()
                } else if (code === 80) {
                    switchPalette()
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
                changeShadingEffect(shadingEffect === 0 ? 3 : shadingEffect - 1)
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

    w = Math.round(innerWidth * devicePixelRatio * quality)
    h = Math.round(innerHeight * devicePixelRatio * quality)
    imageData = ctx.getImageData(0, 0, w, h)
    imageDataBuffer = imageData.data
    pixels = w * h
    canvas.width = previous.width = hidden.width = w
    canvas.height = previous.height = hidden.height = h
    canvas.style.width = previous.style.width = hidden.style.width = Math.ceil(innerWidth) + "px"
    canvas.style.height = previous.style.height = hidden.style.height = Math.ceil(innerHeight) + "px"

    colorDataStart = pixels * 8 + dataStart
    wasmLength = pixels * 4 + colorDataStart
    expandMemory(wasmLength)

    pixelItem = getMemory(1, 0, 32)
    paletteData = getMemory(paletteBytes * 0.25, paletteStart, 32)
    paletteData.set(palette)
    dataArray = getMemory(pixels * 2, dataStart, -32)
    colorBytes = getMemory(pixels * 4, colorDataStart, -8) // In the WebAssembly script, it actually is 32-bit, but for getting this to render to the canvas, we pretend it's 8-bit and it works out.
    colorArray = getMemory(pixels, colorDataStart, 32)
    dataBits = getMemory((wasmLength - dataStart) * 0.25, dataStart, 32)
}

function expandMemory(finalByte) {
    try {
        var byteLength = buffer.byteLength
        if (byteLength < finalByte) {
            memory.grow(Math.ceil((finalByte - byteLength) / 65536))
            buffer = memory.buffer
        }
    } catch (e) {
        help.style.display = "unset"
        help.innerHTML = 'Unfortunately, an error occured while adding more memory. This may be because of default memory limitations; try adding ?maxMB=4096 to the start of the URL (no commas in the number), or check the console if that doesn\'t work. Press Close and export and copy the current fractal position if needed.<br><button onclick="help.removeAttribute(\'style\')" id="infoClose">Close</button>'
        throw e
    }
}

var zoom = 0.004
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

// Movement for touchscreen (confusing)! We have to prevent any zoom of the entire page, and this includes pinch zooming.
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
        currentX = Math.round((touches[0].clientX + touches[1].clientX) * 0.5 * devicePixelRatio * quality)
        currentY = Math.round((touches[0].clientY + touches[1].clientY) * 0.5 * devicePixelRatio * quality)
        var xPinch = touches[0].clientX - touches[1].clientX
        var yPinch = touches[0].clientY - touches[1].clientY
        pinchDist = Math.sqrt(xPinch * xPinch + yPinch * yPinch) * devicePixelRatio
    } else if (length === 1) {
        touchDown = true
        currentX = Math.round(touches[0].clientX * devicePixelRatio * quality)
        currentY = Math.round(touches[0].clientY * devicePixelRatio * quality)
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
        var newDist = Math.sqrt(xPinch * xPinch + yPinch * yPinch) * devicePixelRatio * quality
        var multiplier = 3 * (pinchDist + 10) / (newDist + 10) - 2
        if (multiplier !== 1) {
            updateZoom(multiplier, currentX, currentY)
        }
        pinchDist = newDist
    } else if (touchDown) {
        var touch = touches[0]
        var newX = Math.round(touch.clientX * devicePixelRatio * quality)
        var newY = Math.round(touch.clientY * devicePixelRatio * quality)
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

var shadingEffect = 0
var newShading = 0
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
var quality = 1
var time = performance.now()
var lastOutput = time
var fps = 10
// Weirdly enough, the lower this value, the higher FPS you want. It's a weird formula.
var wantedFPS = 3.45
var mainTime = 0
// Starting guess for the estimated time left (20 seconds)
var previousGuess = 20000
var hideTime = -1
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
            percent.textContent = "Info for (" + currentX + ", " + currentY + "):\r\nIterations before escaping: " + (iters == null || iters == 0 ? "Not calculated yet" : (iters === -999 ? "Doesn't escape" : iters.toFixed(3))) + "\r\nPalette location: " + (iters === -999 ? "Interior" : iters === 1 ? flowAmount % paletteLen : iters === 0 ? "Not calculated yet" : ((Math.log2(iters) * Math.sqrt(Math.sqrt(speed)) + (iters - 1) * 0.035 * speed + flowAmount) % paletteLen).toFixed(3)) + "\r\nRGB color: " + (colorBytes[4 * p + 3] === 0 ? "Transparent" : colorBytes[4 + p] + ", " + colorBytes[4 * p + 1] + ", " + colorBytes[4 * p + 2]) + "\r\nShading amount: " + (shade === 0 ? "None" : shade.toFixed(6))
        } else if (currentX >= 0 && currentY >= 0) {
            percent.textContent = "Cursor location: (" + currentX + ", " + currentY + ")"
        } else {
            percent.textContent = "Select something for more info."
        }
    } else if (Date.now() >= hideTime) {
        percent.textContent = ""
        hideTime = -1
    }
    // Handle the panning by shifting pixels
    if (diffX !== 0 || diffY !== 0) {
        zoomX -= diffX * zoomM
        zoomY -= diffY * zoomM
        doZoom = true
        panX -= diffX * zoom
        panY -= diffY * zoom

        // A fresh buffer to hold the shifted data
        var newData = new Float32Array(pixels * 2)

        // Calculate the dimensions and position of the overlapping rectangle
        var sourceX = diffX > 0 ? 0 : -diffX
        var destX = diffX > 0 ? diffX : 0
        var copyWidth = w - Math.abs(diffX)

        var sourceY = diffY > 0 ? 0 : -diffY
        var destY = diffY > 0 ? diffY : 0
        var copyHeight = h - Math.abs(diffY)

        if (copyWidth > 0 && copyHeight > 0) {
            var iterationSource = dataArray.subarray(0, pixels)
            var iterationDest = newData.subarray(0, pixels)

            for (let y = 0; y < copyHeight; y++) {
                var sourceRowStart = (sourceY + y) * w + sourceX
                var destRowStart = (destY + y) * w + destX
                // Get a view of the source row to copy
                var rowToCopy = iterationSource.subarray(sourceRowStart, sourceRowStart + copyWidth)
                // Set it in the correct place in the destination
                iterationDest.set(rowToCopy, destRowStart)
            }

            if (shadingEffect !== 0) {
                var shadingSource = dataArray.subarray(pixels)
                var shadingDest = newData.subarray(pixels)

                for (let y = 0; y < copyHeight; y++) {
                    var sourceRowStart = (sourceY + y) * w + sourceX
                    var destRowStart = (destY + y) * w + destX
                    var rowToCopy = shadingSource.subarray(sourceRowStart, sourceRowStart + copyWidth)
                    shadingDest.set(rowToCopy, destRowStart)
                }
            }
        }

        dataArray.set(newData)
        unfinished = true
        rerender = true
        diffX = 0
        diffY = 0
    }

    time = performance.now()
    if (shadingEffect !== newShading) {
        if ((shadingEffect === 1 && newShading === 2) || (shadingEffect === 2 && newShading === 1)) {
            requestRender()
        } else if (newShading === 0) {
            getMemory(pixels, dataStart + pixels * 4, -32).fill(0) // Clear shading data
            retry()
        } else {
            redo()
            clearBack()
        }
        shadingEffect = newShading
    }

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
            colorArray.fill(0)
            rerender = false
        }
        for (var t = 0; t < workerCount; t++) {
            messageWebWorker(t, [1, juliaMode ? -fractalType : fractalType, w, h, panX, panY, zoom, workerCosts[t], iterations, paletteLen, interior, renderMode, shadingEffect, speed, flowAmount, juliaX, juliaY]) // Message the parameters to be passed into each worker.
        }
    } else {
        line.removeAttribute("style")
        if (flowRate !== 0) {
            flowAmount += flowRate / 120
            if (flowAmount < 0) {
                flowAmount += paletteLen
            } else if (flowAmount >= paletteLen) {
                flowAmount -= paletteLen
            }
        }
        if (flowRate !== 0 || needRender) {
            rehandle = false
            needRender = false
            setPixel(0)
            var renderCommand = [2, pixels, paletteLen, interior, renderMode, shadingEffect, speed, flowAmount]
            for (let i = 0; i < workerCount; i++) {
                messageWebWorker(i, renderCommand)
            }
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
            var totalCost = 0
            for (var i = 0; i < workerCosts.length; i++) {
                totalCost += workerCosts[i]
            }
            if (!pixelBreakdown) percent.textContent = (100 * ratio).toFixed(2) + "% finished (Taking " + timeToString(mainDiff) + ")\r\nEstimated time left: " + timeToString(timeGuess, true) + "\r\nPerformance: " + (totalCost / workerCount / wantedFPS / 1000).toFixed(2) + "/thread (for " + workerCount + " " + (workerCount === 1 ? "thread" : "threads") + ").\nRendering took " + (performance.now() - imgTime).toFixed(2) + "ms (running at " + fps.toFixed(1) + "fps)"
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
            line.style.top = (Math.floor(highestProgress / (w * quality)) / devicePixelRatio).toFixed(1) + "px"
            line.style.backgroundColor = color
        } else {
            previousGuess = mainDiff
            if (!pixelBreakdown) {
                if (flowRate === 0 || mainDiff < 2000) {
                    percent.textContent = "Took " + timeToString(mainDiff, true) + (quality === 1 ? "." : " (with the quality factor set to " + quality + ").")
                } else if (percent.textContent.length !== 0) {
                    percent.textContent = ""
                }
            }
            line.removeAttribute("style")
            percent.style.color = "#1ad"
            hideTime = Date.now() + 500
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

var scrollMultiplier = 1.025
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
    // Double click events act strange/inconsistent in some browsers, so we use this instead.
    if (e.button === 0 && e.target === canvas || e.target === percent) {
        // If we set the click time to zero, then this statement becomes false.
        var newX = Math.round(e.clientX * devicePixelRatio * quality)
        var newY = Math.round(e.clientY * devicePixelRatio * quality)
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
        currentX = Math.round(e.clientX * devicePixelRatio * quality)
        currentY = Math.round(e.clientY * devicePixelRatio * quality)
        diffX += currentX - oldX
        diffY += currentY - oldY
    } else if (!touchDown) {
        currentX = Math.round(e.clientX * devicePixelRatio * quality)
        currentY = Math.round(e.clientY * devicePixelRatio * quality)
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
        currentX = Math.round(e.clientX * devicePixelRatio * quality)
        currentY = Math.round(e.clientY * devicePixelRatio * quality)
        var scrollAmount = e.deltaY
        var s = scrollMultiplier === 1 ? Math.pow(1.1, Math.sign(scrollAmount)) : Math.pow(scrollMultiplier, Math.pow(Math.abs(scrollAmount), 0.7) * Math.sign(scrollAmount))
        updateZoom(s, currentX, currentY)
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
    buttons[index].style.backgroundColor = hue === 1 ? "rgb(85,200,90)" : "rgb(" + Math.min(800 - hue * 700, 230) + "," + Math.floor(hue * 200) + ",60)"
}

function switchPalette() {
    if (paletteOverride) {
        paletteOverride = false
    } else {
        paletteID++
    }
    if (paletteID === totalPalettes) {
        paletteID = 0
    }
    flowAmount = 0
    palette = palettes[paletteID]
    interior = interiors[paletteID]
    paletteLen = palette.length - 1
    paletteData.set(palette)
    requestRender()
}

function customizePalette() {
    var nextColors = decodePalette(newPalette.value.split(" ")).slice(0, 25000)
    if (nextColors !== false) {
        flowAmount = 0
        paletteOverride = true
        palette = nextColors
        paletteLen = palette.length - 1
        interior = palette.pop() ^ 0xff000000
        palette.push(palette[0])
        paletteData.set(palette)
        clearBack()
        retry()
    }
}

const hexStr = "0123456789abcdef"
function decodePalette(colors) {
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
                hex = hexStr.indexOf(c[0]) * 17 + hexStr.indexOf(c[1]) * 4352 + hexStr.indexOf(c[1]) * 69632 // These may seem like magic numbers, but it's just converting #1bc, for example, into #11bbcc.
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

function switchShadingEffect() {
    changeShadingEffect(shadingEffect === 3 ? 0 : shadingEffect + 1)
}

function changeShadingEffect(newEffect) {
    newShading = newEffect
    colorButton(3, newEffect / 3)
}

function switchAliasMode() {
    var oldAlias = quality
    quality = quality === 1 ? 1.1 :
        quality === 1.1 ? 1.25 :
            quality === 1.25 ? 2 :
                quality === 2 ? 0.5 :
                    1
    zoom *= oldAlias / quality
    needResize = 2
    colorButton(4, quality * 3 - 3)
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

function saveLocation() {
    var str
    if (juliaMode) {
        str = "X: " + panX + " Y: " + panY + " Zoom: " + (zoom * w) + " Type: " + fractalNames[fractalType] + " Julia Shading: " + shadingNames[shadingEffect] + " Julia X: " + juliaX + " Julia Y: " + juliaY
    } else {
        str = "X: " + panX + " Y: " + panY + " Zoom: " + (zoom * w) + " Type: " + fractalNames[fractalType] + " Shading: " + shadingNames[shadingEffect]
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
                if (panX !== a || panY !== b || zoom !== c || fractalType !== d || shadingEffect !== e) {
                    panX = a
                    panY = b
                    zoom = c / w
                    fractalType = d
                    shadingEffect = e
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

// Color the buttons as needed, based on their ordering in the HTML
colorButton(2, renderMode * 0.35)
colorButton(3, shadingEffect / 3)
colorButton(4, quality * 3 - 3)
colorButton(5, flowRate / 6 + 0.5)
colorButton(6, -flowRate / 6 + 0.5)
colorButton(8, 0.5)
colorButton(9, 0.5)
colorButton(11, Math.log10(iterations) * 0.25)
colorButton(12, pixelBreakdown)