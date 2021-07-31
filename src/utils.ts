type NamingStyle = 'javascript' | 'java';

interface Config {
  style: NamingStyle;
  plural: { [key: string]: string };
}

export const config: Config = {
  style: 'javascript',
  plural: {
    child: 'children'
  }
};

export function pluralise(name: string): string {
  const forms = config.plural;

  if (name in forms) {
    return forms[name];
  }

  if (config.style === 'java') {
    return name + 'List';
  }

  for (const key in forms) {
    if (name.endsWith(key)) {
      return name.substr(0, name.length - key.length) + forms[key];
    }
    if (name.endsWith(ucfirst(key))) {
      return name.substr(0, name.length - key.length) + ucfirst(forms[key]);
    }
  }

  let result;

  if ((result = name.replace(/([^aeiou])y$/i, '$1ies')) != name) {
    return result;
  }

  if ((result = name.replace(/s$/, 'ses')) != name) {
    return result;
  }

  return name + 's';
}

export function lcfirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function ucfirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function toCamelCase(s: string): string {
  return s.replace(/_\w/g, m => m[1].toUpperCase());
}

export function toPascalCase(s: string): string {
  return toCamelCase(ucfirst(s));
}

export function setPluralForms(data: { [key: string]: string }): void {
  for (const key in data) {
    config.plural[key] = data[key];
  }
}

export function setPluralForm(singular: string, plural: string): void {
  config.plural[singular] = plural;
}

export function pluck<T extends { [key: string]: any }>(from: T, keys: (keyof T)[]): Partial<T> {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (key in from) {
      result[key] = from[key];
    }
  }
  return result;
}