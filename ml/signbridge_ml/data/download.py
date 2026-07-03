"""Downloads the Google - Isolated Sign Language Recognition (GISLR) dataset
from Kaggle into ml/data/raw/. Requires a Kaggle API token at
~/.kaggle/kaggle.json (kaggle.com/settings -> Create New Token) and that the
account has joined the "asl-signs" competition (Kaggle requires accepting
competition rules before the data can be downloaded).
"""
import sys
import zipfile
from pathlib import Path

COMPETITION = "asl-signs"
ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "ml" / "data" / "raw"


def main() -> None:
    kaggle_json = Path.home() / ".kaggle" / "kaggle.json"
    if not kaggle_json.exists():
        print(
            "No Kaggle API token found at "
            f"{kaggle_json}\n\n"
            "1. Create/log into a Kaggle account\n"
            "2. Join the competition: https://www.kaggle.com/competitions/asl-signs/rules\n"
            "3. Go to kaggle.com/settings -> API -> Create New Token\n"
            f"4. Save the downloaded kaggle.json to {kaggle_json}\n",
            file=sys.stderr,
        )
        sys.exit(1)

    from kaggle.api.kaggle_api_extended import KaggleApi  # imported lazily: needs the token to init

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    api = KaggleApi()
    api.authenticate()

    zip_path = RAW_DIR / f"{COMPETITION}.zip"
    if not zip_path.exists() and not (RAW_DIR / "train.csv").exists():
        print(f"Downloading {COMPETITION} (~55 GB, this will take a while)...")
        try:
            api.competition_download_files(COMPETITION, path=str(RAW_DIR), quiet=False)
        except Exception as err:  # Kaggle raises a generic ApiException
            print(
                f"Download failed: {err}\n"
                "Most likely cause: you haven't accepted the competition rules yet at "
                "https://www.kaggle.com/competitions/asl-signs/rules",
                file=sys.stderr,
            )
            sys.exit(1)
    else:
        print("Zip or extracted data already present, skipping download.")

    if zip_path.exists() and not (RAW_DIR / "train.csv").exists():
        print("Extracting...")
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(RAW_DIR)
        zip_path.unlink()

    print(f"Done: {RAW_DIR}")


if __name__ == "__main__":
    main()
