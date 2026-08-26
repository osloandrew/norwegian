import csv
import gzip
import importlib.util
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "export_nb_ngram_frequency",
    ROOT / "scripts" / "export-nb-ngram-frequency.py",
)
export_nb_ngram_frequency = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = export_nb_ngram_frequency
SPEC.loader.exec_module(export_nb_ngram_frequency)


def build_csv_bytes(rows: list[tuple[str, str, str]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["first", "lang", "freq", "json"])
    for first, lang, freq in rows:
        writer.writerow([first, lang, freq, '{"2021":1}'])
    return buffer.getvalue().encode("utf-8")


class NbNgramFrequencyExportTests(unittest.TestCase):
    def test_stream_filters_to_target_language(self):
        csv_bytes = build_csv_bytes(
            [
                ("hus", "nob", "1000"),
                ("hus", "nno", "400"),
                ("!", "nob", "9248"),
                ("fisk", "nob", "0"),
            ]
        )
        rows = export_nb_ngram_frequency.stream_language_frequencies(
            io.BytesIO(csv_bytes), "nob"
        )
        # "hus"/nno is a different language, and the zero-frequency "fisk"
        # row carries no evidence — both are excluded.
        self.assertEqual(rows, [(1000, "hus"), (9248, "!")])

    def test_export_downloads_gzip_csv_and_writes_shared_tsv_shape(self):
        csv_bytes = build_csv_bytes(
            [
                ("hus", "nob", "1000"),
                ("hus", "nno", "400"),
                ("bok", "nob", "5000"),
            ]
        )
        gzipped = gzip.compress(csv_bytes)

        with tempfile.TemporaryDirectory() as temp_dir, mock.patch(
            "urllib.request.urlopen", return_value=io.BytesIO(gzipped)
        ):
            output = Path(temp_dir) / "nb-ngram.tsv"
            export_nb_ngram_frequency.export_frequency_list(output, limit=100)

            data_rows = [
                line
                for line in output.read_text(encoding="utf-8").splitlines()
                if not line.startswith("#")
            ]
            self.assertEqual(data_rows, ["5000\tbok", "1000\thus"])
            header = output.read_text(encoding="utf-8").splitlines()[:5]
            self.assertTrue(any("CC0" in line for line in header))

    def test_export_truncates_to_limit(self):
        csv_bytes = build_csv_bytes(
            [
                ("bok", "nob", "5000"),
                ("hus", "nob", "1000"),
                ("fisk", "nob", "500"),
            ]
        )
        gzipped = gzip.compress(csv_bytes)

        with tempfile.TemporaryDirectory() as temp_dir, mock.patch(
            "urllib.request.urlopen", return_value=io.BytesIO(gzipped)
        ):
            output = Path(temp_dir) / "nb-ngram.tsv"
            export_nb_ngram_frequency.export_frequency_list(output, limit=2)

            data_rows = [
                line
                for line in output.read_text(encoding="utf-8").splitlines()
                if not line.startswith("#")
            ]
            self.assertEqual(data_rows, ["5000\tbok", "1000\thus"])


if __name__ == "__main__":
    unittest.main()
