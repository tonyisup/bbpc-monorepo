export function buildLocalImportSpec(file, emptyJsonArrayPath) {
  if (
    typeof file !== "object" ||
    file === null ||
    typeof file.filePath !== "string" ||
    typeof file.table !== "string" ||
    !Number.isSafeInteger(file.rowCount) ||
    file.rowCount < 0
  ) {
    throw new Error("A verified staging file is required");
  }
  if (file.rowCount === 0) {
    if (
      typeof emptyJsonArrayPath !== "string" ||
      emptyJsonArrayPath.length === 0
    ) {
      throw new Error(
        "An empty JSON-array replacement file is required",
      );
    }
    return {
      filePath: emptyJsonArrayPath,
      format: "jsonArray",
    };
  }
  return {
    filePath: file.filePath,
    format: "jsonLines",
  };
}
