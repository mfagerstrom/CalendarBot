export const getGithubErrorMessage = (error: any): string => {
  const status = error?.response?.status as number | undefined;
  const message = error?.response?.data?.message as string | undefined;
  const errorMessage = error?.message as string | undefined;

  const outputParts: string[] = [];
  if (status) {
    outputParts.push(`Github status: ${status}`);
  }
  if (message) {
    outputParts.push(`Github error: ${message}`);
  } else if (errorMessage) {
    outputParts.push(`Github error: ${errorMessage}`);
  }

  if (outputParts.length) {
    return outputParts.join("\n");
  }
  return "GitHub request failed. Check the GitHub App configuration.";
};
