import os

# Root directory to start
root_dir = r"D:\chessweb\src"

# Output file (will be created in the root_dir)
output_file = os.path.join(root_dir, "all_files_combined.txt")

# Files to skip
skip_files = {
    ".gitignore",
    ".all-contributorsrc",
    "CONTRIBUTING.md",
    "package-lock.json",
    "yarn.lock",
    os.path.basename(output_file)  # skip the output file itself
}

with open(output_file, "w", encoding="utf-8") as out_f:
    for dirpath, dirnames, filenames in os.walk(root_dir):
        for filename in filenames:
            if filename in skip_files:
                continue

            file_path = os.path.join(dirpath, filename)
            out_f.write(f"----- {file_path} -----\n")
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    out_f.write(f.read())
            except Exception as e:
                out_f.write(f"[Could not read file: {e}]\n")
            out_f.write("\n\n")  # Separate files by newlines

print(f"All selected files combined into: {output_file}")
