#!/usr/bin/env python3
"""
upload-cos.py
Uploads the ./out/ static export to Tencent Cloud COS with correct MIME types.
Uses the official cos-python-sdk-v5 which lets us set Content-Type explicitly.
"""
import os
import sys
import mimetypes

# Ensure common types are registered (Ubuntu mimetypes DB can be incomplete)
mimetypes.add_type("text/html", ".html")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("image/webp", ".webp")

from qcloud_cos import CosConfig, CosS3Client  # type: ignore

region = os.environ["COS_REGION"]
secret_id = os.environ["TENCENT_SECRET_ID"]
secret_key = os.environ["TENCENT_SECRET_KEY"]
bucket = os.environ["TENCENT_COS_BUCKET"]
out_dir = os.environ.get("OUT_DIR", "out")

config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key)
client = CosS3Client(config)

uploaded = 0
errors = 0

for root, _dirs, files in os.walk(out_dir):
    for filename in files:
        filepath = os.path.join(root, filename)
        # Key = path relative to out_dir, no leading slash
        key = os.path.relpath(filepath, out_dir).replace("\\", "/")

        content_type, _ = mimetypes.guess_type(filepath)
        if not content_type:
            content_type = "application/octet-stream"

        # Cache headers
        if ".html" in filename:
            cache = "no-cache, no-store, must-revalidate"
        elif "_next/static" in key:
            cache = "public, max-age=31536000, immutable"
        else:
            cache = "public, max-age=86400"

        try:
            with open(filepath, "rb") as f:
                client.put_object(
                    Bucket=bucket,
                    Body=f,
                    Key=key,
                    ContentType=content_type,
                    CacheControl=cache,
                )
            print(f"  ✓ {key}  ({content_type})")
            uploaded += 1
        except Exception as e:
            print(f"  ✗ {key}  ERROR: {e}", file=sys.stderr)
            errors += 1

print(f"\n{'✅' if errors == 0 else '⚠️'} Uploaded {uploaded} files, {errors} errors.")
if errors > 0:
    sys.exit(1)
