import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "export_opensubtitles_frequency",
    ROOT / "scripts" / "export-opensubtitles-frequency.py",
)
export_opensubtitles_frequency = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = export_opensubtitles_frequency
SPEC.loader.exec_module(export_opensubtitles_frequency)


class FakeResponse:
    def __init__(self, data: bytes):
        self._data = data

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


class OpenSubtitlesFrequencyExportTests(unittest.TestCase):
    def test_export_reverses_word_count_columns_into_shared_tsv_shape(self):
        fake_data = "jeg 2069150\ndet 1979613\ner 1826440\n".encode("utf-8")

        with tempfile.TemporaryDirectory() as temp_dir, mock.patch(
            "urllib.request.urlopen", return_value=FakeResponse(fake_data)
        ):
            output = Path(temp_dir) / "opensubtitles.tsv"
            export_opensubtitles_frequency.export_frequency_list(output)

            data_rows = [
                line
                for line in output.read_text(encoding="utf-8").splitlines()
                if not line.startswith("#")
            ]
            self.assertEqual(
                data_rows,
                ["2069150\tjeg", "1979613\tdet", "1826440\ter"],
            )
            header = output.read_text(encoding="utf-8").splitlines()[:4]
            self.assertTrue(any("CC BY-SA-4.0" in line for line in header))

    def test_parser_skips_blank_and_malformed_lines(self):
        self.assertEqual(
            export_opensubtitles_frequency.parse_word_count_lines(
                "jeg 100\n\nnotacount\ndet 50\n"
            ),
            [(100, "jeg"), (50, "det")],
        )


if __name__ == "__main__":
    unittest.main()
