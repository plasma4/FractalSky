## FractalSky
A fractal viewer optimized for the web. Supports a variety of features. **View online at https://fractalsky.netlify.app/** and take a look at the options with the Info button.

### Local installation instructions
- [Install Emscripten](https://emscripten.org/docs/getting_started/downloads.html) if you don't have it already.
- Activate emsdk through your terminal every time you set this up (easy to forget)! Depending on your OS this is different. You'll need to do this to set up the PATH variables correctly.
- Compile with `emcc` using the following:
```shell
emcc -O3 -ffast-math -s WASM=1 -s SIDE_MODULE=2 -s NO_EXIT_RUNTIME=1 -s NODEJS_CATCH_REJECTION=0 -s WASM_BIGINT=0 -Wl,--no-entry -s ALLOW_MEMORY_GROWTH=1 -s SHARED_MEMORY=1 -s -s EXPORTED_FUNCTIONS="['_run','_render']" -o fractal.wasm fractal.cpp
```
(You might need to modify the paths of fractal.wasm and fractal.cpp).
- Set up your local live server. It's easiest to install the Microsoft Live Preview extension from VSCode. If it doesn't work the first time, try to install an older version and maybe update back (this did the trick for me). Be sure to add the following JSON to your VSCode's `settings.json` if you do use it:
```json
    "livePreview.httpHeaders": {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin"
    }
```
Be sure to open up the server in an external browser! FractalSky works best in Firefox, although Chrome also works.
- Once production-ready, import the resulting .wasm into [wasm2wat](https://webassembly.github.io/wabt/demo/wasm2wat/) and modify Emscripten constants (explained below). Then import into [wat2wasm](https://webassembly.github.io/wabt/demo/wat2wasm/) and paste in the .wat text. Make sure to click **threads** as an enabled feature in wat2wasm, or else it won't compile. Click Download once finished.

Modify by replacing
```js
  (import "env" "memory" (memory $env.memory 0 65536 shared))
  (func $__wasm_call_ctors (export "__wasm_call_ctors") (export "__wasm_apply_data_relocs") (type $t0)
    (nop))
```
with
```js
  (import "env" "memory" (memory $env.memory 0 20000 shared))
```
Then copy this data and use the instructions above.
This way, the maximum memory is reduced and a little bit of unused Emscripten stuff is removed. This isn't important for testing, but it's nice to change while compiling.