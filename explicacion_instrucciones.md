# Cómo funciona el pipeline de zklogin-windows-quickstart

Este documento explica, paso a paso y desde cero, qué hace cada comando del
proyecto de prueba `hello_zk.circom`, y después qué cambia cuando pasás al
circuito completo de zkLogin (`sig_verify.circom`).

---

## Idea general: ¿qué estamos probando?

Una **prueba de conocimiento cero (ZKP)** te permite demostrarle a alguien
que sabés algo, **sin revelar qué es lo que sabés**.

Ejemplo del circuito `hello_zk.circom`: vos "sabés" un número secreto
(`preimage`, ej. `1234`). Aplicándole una función matemática llamada
**Poseidon** (un tipo de hash, como una licuadora que mezcla el número de
forma irreversible) obtenés otro número (`hash`). La prueba te permite
convencer a alguien de *"conozco un número que, licuado con Poseidon, da
exactamente este resultado"*, sin decirle cuál es el número.

Esto es exactamente el mismo principio que usa zkLogin en el paper, pero en
vez de un número simple, ellos prueban *"conozco un JWT válido firmado por
Google que corresponde a esta dirección"*, sin revelar el JWT.

## El pipeline completo, en 6 etapas

```
1. hello_zk.circom          →  código fuente del circuito
2. circom (compilador)      →  genera .r1cs y .wasm
3. trusted setup (Groth16)  →  powers of tau + zkey
4. generate_witness.js      →  input.json + wasm → witness.wtns
5. snarkjs groth16 prove    →  zkey + witness → proof.json
6. snarkjs groth16 verify   →  vkey + proof → OK / error
```

---

## Etapa 1 — El circuito: `hello_zk.circom`

Es un archivo de texto donde escribís, en un lenguaje llamado **circom**,
la "regla matemática" que querés que se cumpla. En nuestro caso, la regla
es una sola línea:

```
hash === hasher.out;
```

Es decir: "el valor público `hash` tiene que ser igual al resultado de
aplicarle Poseidon al valor privado `preimage`". Esto todavía no es código
que se ejecuta — es una **especificación**, como un plano.

## Etapa 2 — Compilar con `circom`

```powershell
circom circuits\hello_zk.circom --r1cs --wasm --sym -o build
```

`circom` (el programa que instalaste) lee ese plano y lo traduce a dos
formatos que las herramientas siguientes necesitan:

- **`.r1cs`** ("Rank-1 Constraint System"): es la representación matemática
  pura de las restricciones — un montón de ecuaciones que deben cumplirse.
  Esto es lo que se usa para el paso de "trusted setup" (etapa 3).
- **`.wasm`**: un programita compilado (WebAssembly) que, dado un
  `preimage` concreto, **calcula** todos los valores intermedios necesarios
  (el "witness") para que las ecuaciones cierren. Esto es lo que se usa en
  la etapa 4.

Pensalo así: el `.r1cs` es "las reglas del juego", el `.wasm` es "la
calculadora que te dice los números exactos para un caso particular".

## Etapa 3 — Trusted setup (Groth16)

```powershell
npx snarkjs powersoftau new bn128 12 build\pot_0000.ptau -v
npx snarkjs powersoftau contribute build\pot_0000.ptau build\pot_0001.ptau --name="local" -v -e="cualquier texto random"
npx snarkjs powersoftau prepare phase2 build\pot_0001.ptau build\pot_final.ptau -v

npx snarkjs groth16 setup build\hello_zk.r1cs build\pot_final.ptau build\hello_zk_0000.zkey
npx snarkjs zkey contribute build\hello_zk_0000.zkey build\hello_zk_final.zkey --name="local" -v -e="otro texto random"
npx snarkjs zkey export verificationkey build\hello_zk_final.zkey build\verification_key.json
```

Groth16 (el sistema de pruebas que usamos, igual que el paper de zkLogin)
necesita, antes de poder generar o verificar pruebas, un conjunto de
**parámetros públicos especiales** ligados a este circuito específico (el
archivo `.zkey`). Generar esos parámetros requiere un número aleatorio
secreto que, si alguien lo conserva, **podría fabricar pruebas falsas**.
Por eso se hace una "ceremonia": alguien (vos, en este caso, para pruebas)
genera esa aleatoriedad y después la descarta. Es un paso que se hace **una
sola vez por circuito**, no en cada prueba.

Salen dos archivos importantes:
- **`hello_zk_final.zkey`**: lo necesita quien *genera* pruebas (el "prover").
- **`verification_key.json`**: lo necesita quien *verifica* pruebas (el
  "verifier") — este es chico y se puede compartir libremente, no es secreto.

## Etapa 4 — Generar el witness

```powershell
node build\hello_zk_js\generate_witness.js build\hello_zk_js\hello_zk.wasm build\input.json build\witness.wtns
```

Acá le das el `.wasm` de la etapa 2 y tu `input.json` (con `preimage` y
`hash`). El programa **corre las ecuaciones** con esos valores concretos y
produce el **witness** (`witness.wtns`): todos los números intermedios que
hacen que las restricciones se cumplan. Si el `hash` que pusiste no
corresponde al `preimage`, esto **falla acá mismo** — es la prueba de
*soundness*: sin un testigo válido, ni siquiera se puede generar el witness.

## Etapa 5 — Generar la prueba

```powershell
npx snarkjs groth16 prove build\hello_zk_final.zkey build\witness.wtns build\proof.json build\public.json
```

Con el `.zkey` (de la etapa 3) y el `witness.wtns` (de la etapa 4),
`snarkjs` produce la **prueba criptográfica real**: `proof.json`. Es un
objeto matemático compacto (unos pocos números) que "resume" el
conocimiento del witness sin revelarlo. También se genera `public.json`,
que son los valores **públicos** de la prueba (en nuestro caso, el `hash`
— recordá que ese sí se puede mostrar, lo que se esconde es el `preimage`).

## Etapa 6 — Verificar

```powershell
npx snarkjs groth16 verify build\verification_key.json build\public.json build\proof.json
```

Cualquiera que tenga la `verification_key.json` (pública, sin secretos)
puede tomar `proof.json` + `public.json` y chequear matemáticamente si la
prueba es válida, en milisegundos, **sin necesitar el witness ni el
preimage**. Si todo cierra, dice `OK!`.

**En una frase:** el archivo `.circom` define la regla, `circom` la
traduce a algo computable, el trusted setup genera las "llaves" del
circuito, el witness calcula tu caso concreto, la prueba lo comprime en un
objeto criptográfico, y la verificación chequea esa prueba sin necesitar
saber tu secreto.

---

## Qué cambia con el circuito real de zkLogin (`sig_verify.circom`)

La estructura del pipeline es exactamente la misma (mismas 6 etapas), pero
cambia el **contenido** de cada una.

### Etapa 1 — El circuito

En vez de una sola línea (`hash === hasher.out`), acá hay **dos** reglas
que se tienen que cumplir simultáneamente:

```
1. EdDSA-Poseidon.Verify(pubKey, msg, sig)         // la firma es válida
2. addr === Poseidon(pubKeyX, pubKeyY, salt)        // la dirección está bien calculada
```

Esto es el análogo directo de lo que el paper de zkLogin llama `Ckt`
(Fig. 7):

```
JWT.Verify(pk_OP, jwt)                              // el JWT tiene firma válida del proveedor
zkaddr === H(stid, aud, iss, salt)                  // la dirección deriva del identificador + salt
```

Nuestro circuito reemplaza "JWT firmado con RSA+SHA256" por "mensaje
firmado con EdDSA+Poseidon" — mismo *patrón*, primitivas distintas
(justamente la extensión que estamos explorando en el proyecto).

### Etapa 2 — Compilar

Mismo comando (`circom circuits\sig_verify.circom --r1cs --wasm --sym -o build`),
pero el resultado es mucho más grande: **~8.700 restricciones** (vs. las
~216 de `hello_zk`). Verificar una firma implica muchas más operaciones
aritméticas que un solo hash.

### Etapa 3 — Trusted setup

Acá está el cambio práctico más importante en Windows. El `powersoftau`
necesita una potencia de 2 que sea **mayor o igual** a la cantidad de
restricciones:

| Circuito | Restricciones | Potencia de ptau necesaria |
|---|---|---|
| `hello_zk` | ~216 | `2^12 = 4096` → usamos `bn128 12` |
| `sig_verify` | ~8.700 | `2^14 = 16384` → hay que usar `bn128 14` |

O sea, en los comandos hay que cambiar el `12` por `14`:
```powershell
npx snarkjs powersoftau new bn128 14 build\pot_0000.ptau -v
```
Este paso va a tardar más que con `hello_zk` (puede ser cuestión de
minutos en vez de segundos, dependiendo de la PC).

### Etapa 4 — Generar el witness

También cambia el `input.json`. Para `hello_zk` eran 2 campos (`preimage`,
`hash`). Para `sig_verify` son **8 campos**:

| Campo | Público/privado | Qué es |
|---|---|---|
| `msg` | público | el "mensaje" firmado (stand-in de los claims del JWT) |
| `pubKeyX`, `pubKeyY` | público | clave pública del firmante (el "OP") |
| `salt` | público | la aleatoriedad que da privacidad (unlinkability) |
| `addr` | público | la dirección reclamada, `Poseidon(pubKey, salt)` |
| `R8x`, `R8y`, `S` | **privados** | la firma EdDSA en sí — esto es el "witness" secreto |

Nota que casi todo es público salvo la firma — es al revés de lo que uno
esperaría intuitivamente, pero tiene sentido: lo que zkLogin (y este
circuito) esconde no es la dirección ni el mensaje, sino **la prueba de que
existe una firma válida que los conecta**, sin mostrar esa firma.

### Etapas 5 y 6 — Prueba y verificación

Los comandos son idénticos en forma, solo cambian los nombres de archivo
(`sig_verify_final.zkey` en vez de `hello_zk_final.zkey`, etc.). La
diferencia real es el **tiempo**: generar y verificar la prueba va a
tardar más porque el circuito es ~40 veces más grande — pero seguís
hablando de segundos, no minutos, en una PC normal.

---

## Recomendación práctica

Antes de meterte con `sig_verify.circom`, probá primero solo la **etapa 3
con potencia 14** usando el mismo `hello_zk` (cambiando el `12` por `14`
en el comando de `powersoftau`), para ver cuánto tarda tu PC con ese
tamaño de ceremonia, sin arriesgar que se cuelgue algo más complejo. Si eso
anda rápido, seguí directo con el circuito completo.
