// Minimal `vscode` stand-in for unit tests run outside the extension host.
// Implements the l10n.t() substitution used by the source modules.
type L10nArg = string | number | boolean;

export const l10n = {
  t(
    message: string | { message: string; args?: L10nArg[] | Record<string, L10nArg> },
    ...args: L10nArg[]
  ): string {
    const template = typeof message === 'string' ? message : message.message;
    const values: L10nArg[] | Record<string, L10nArg> =
      typeof message === 'string' ? args : (message.args ?? []);

    return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
      const value = Array.isArray(values) ? values[Number(key)] : values[key];
      return value === undefined ? `{${key}}` : String(value);
    });
  },
};
