"use strict"
var workerID = -1, memory = null, buffer = null, handlePixels = null, handleRender = null
onmessage = e => {
    var data = e.data
    if (data.id) {
        workerID = data.id
    }
    if (data.mem) {
        memory = data.mem
        setupWorker()
    }
    if (typeof data[0] === "number") {
        var sliced = data.slice(1)
        if (data[0] === 1) {
            postMessage(handlePixels.apply(this, sliced))
        } else if (data[0] === 2) {
            postMessage(handleRender.apply(this, sliced))
        }
    }
}

function setupWorker() {
    WebAssembly.instantiateStreaming(fetch("fractal.wasm"), {
        env: {
            memory: memory
        }
    }).then(result => {
        handlePixels = result.instance.exports.run
        handleRender = result.instance.exports.render
        postMessage(-2)
    })
}