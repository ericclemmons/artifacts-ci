export function cleanRepoName(value: string) {
  const name = value.trim();

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(
      "Repo names must start with a letter or digit and contain only letters, digits, '.', '_', or '-'.",
    );
  }

  return name;
}
