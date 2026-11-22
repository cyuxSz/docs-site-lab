# three.js vendorizado para el visor de modelos 3D

`public/vendor/three/three-visor.js` es three.js 0.187.0 (r187, MIT) empaquetado con lo mínimo que usa
`src/lib/modelo-visor.ts`: núcleo WebGL, `STLLoader`, `GLTFLoader` y `OrbitControls`. No es una dependencia de npm:
el archivo se guarda en el repo y un test fija su sha256. La licencia está en `public/vendor/three/LICENSE`.

- Tamaño: 645 621 bytes (unos 162 KB con gzip).
- sha256: `3ec0656145b934c9f0c1b5f009df4e2cf1a11aeb17c39158b53c885743e0caa8`
- Sin `eval`, `new Function`, workers ni WASM. No incluye los decodificadores de Draco, Meshopt ni KTX2.

## Cómo se regenera

Hazlo en una carpeta temporal fuera del repo.

1. Descarga el paquete y comprueba su integridad:

   ```sh
   npm pack three@0.187.0
   ```

   Integridad esperada del tarball (`npm view three@0.187.0 dist.integrity`):
   `sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==`

2. Descomprime el tarball. Queda la carpeta `package/`.

3. Empaqueta `tools/vendor-three/entrada.js` con el esbuild 0.28.x del repo (`node_modules/.bin/esbuild`):

   ```sh
   esbuild tools/vendor-three/entrada.js --bundle --format=esm --minify --target=es2022 --legal-comments=none \
     --alias:three=<carpeta>/package/build/three.module.js \
     --alias:three/addons=<carpeta>/package/examples/jsm \
     --banner:js="/* three.js r187 (0.187.0, MIT, https://github.com/mrdoob/three.js): nucleo WebGL, STLLoader, GLTFLoader y OrbitControls. Empaquetado con esbuild; ver LICENSE. */" \
     --outfile=public/vendor/three/three-visor.js
   ```

4. Comprueba el resultado con `sha256sum public/vendor/three/three-visor.js`. Si cambia la versión de three o de esbuild, el
   sha256 cambia: actualiza este archivo y `tests/d-modelo-portal.test.mjs` en el mismo cambio, y copia el `LICENSE` nuevo.

`.gitattributes` marca `public/vendor/**` como `-text` para que git no toque los finales de línea del paquete.
