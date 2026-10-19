// Validação de valores do motor de injeção (633.js), sem processo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, decode, inferTypeFromName, cleanFlagName } = require(process.env.HELPER_DIR + '/633.js');

test('bool aceita só valores claros', () => {
  for (const v of ['true', 'TRUE', '1', 'yes', 'on']) assert.deepEqual([...encode('bool', v).data], [1]);
  for (const v of ['false', '0', 'no', 'off']) assert.deepEqual([...encode('bool', v).data], [0]);
  for (const v of ['', 'talvez', '2']) assert.equal(encode('bool', v).ok, false);
});

test('int: inteiro de 32 bits, sem truncar nem virar 0', () => {
  assert.equal(encode('int', '60').data.readInt32LE(0), 60);
  assert.equal(encode('int', '60.0').data.readInt32LE(0), 60);
  assert.equal(encode('int', '-2147483648').ok, true);
  for (const v of ['', 'abc', '1.5', '2147483648', 'NaN']) assert.equal(encode('int', v).ok, false, v);
});

test('float: finito e dentro do limite', () => {
  assert.equal(encode('float', '0.5').data.readFloatLE(0), 0.5);
  for (const v of ['', 'abc', 'Infinity', '1e40']) assert.equal(encode('float', v).ok, false, v);
});

test('texto: até 15 bytes, codificado como buffer interno + tamanho', () => {
  const e = encode('string', 'abc');
  assert.equal(e.data.length, 24);
  assert.equal(decode('string', e.data), 'abc');
  assert.equal(encode('string', 'x'.repeat(16)).ok, false);
});

test('tipo pelo prefixo mais longo', () => {
  assert.equal(inferTypeFromName('DFIntX'), 'int');
  assert.equal(inferTypeFromName('FFloatX'), 'float');
  assert.equal(inferTypeFromName('DFFlagX'), 'bool');
  assert.equal(inferTypeFromName('FStringX'), 'string');
  assert.equal(cleanFlagName('DFIntTaskSchedulerTargetFps'), 'TaskSchedulerTargetFps');
});
