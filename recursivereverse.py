import os

root_dir = r"C:\Users\Shivam\Downloads\CameraChessWeb-main2\CameraChessWeb-main\src"
combined_file = os.path.join(root_dir, "all_files_combined.txt")

expected_files = set()

def norm(p):
    return os.path.normpath(p)

with open(combined_file, "r", encoding="utf-8") as f:
    text = f.read()

# Split by delimiter lines
blocks = text.split("----- ")
blocks = blocks[1:]  # first split is empty

for block in blocks:
    header, _, body = block.partition(" -----\n")
    file_path = header.strip()

    # IMPORTANT: remove the separator added by combine script
    if body.endswith("\n\n"):
        body = body[:-2]

    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(body)

    expected_files.add(norm(file_path))

# Delete files not listed in txt (inside src only)
for dirpath, _, filenames in os.walk(root_dir):
    for filename in filenames:
        full_path = norm(os.path.join(dirpath, filename))

        if full_path == norm(combined_file):
            continue

        if full_path not in expected_files:
            os.remove(full_path)

# Remove empty directories
for dirpath, _, _ in os.walk(root_dir, topdown=False):
    if dirpath == root_dir:
        continue
    if not os.listdir(dirpath):
        os.rmdir(dirpath)

print("✅ Exact reconstruction complete (line-count stable)")
