// Mutex simple basado en cadena de promesas: serializa la ejecución de fn
// para evitar carreras check-then-insert. No reentrante.
function createMutex() {
  let chain = Promise.resolve();
  return async function runExclusive(fn) {
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    const previous = chain;
    chain = next;
    try {
      await previous;
      return await fn();
    } finally {
      release();
    }
  };
}

module.exports = { createMutex };
