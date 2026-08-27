/**
 * Choose a model without hardcoding one.
 *
 * The extension ships no required model: whatever the user already has
 * installed is what it uses. Naming a specific model here would turn "load the
 * extension and point it at a server" back into a download step.
 */

/**
 * @param {Array<{name: string, isEmbedding?: boolean, isThinking?: boolean}>} models
 * @param {string} [preferred] keep this one if the server still has it
 * @returns {string} a model name, or '' when the server has nothing usable
 */
export function pickModel(models, preferred) {
  const usable = (models ?? []).filter((m) => m && m.name && !m.isEmbedding);
  if (preferred && usable.some((m) => m.name === preferred)) return preferred;

  // A reasoning model can spend its whole output budget on <think> and return
  // no translation, so it is only chosen when nothing else is available.
  const plain = usable.filter((m) => !m.isThinking);
  return (plain[0] ?? usable[0])?.name ?? '';
}
