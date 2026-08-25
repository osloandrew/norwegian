import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "export_clarino_frequency",
    ROOT / "scripts" / "export-clarino-frequency.py",
)
export_clarino_frequency = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = export_clarino_frequency
SPEC.loader.exec_module(export_clarino_frequency)


class ClarinoFrequencyExportTests(unittest.TestCase):
    def test_export_uses_direct_attribute_frequency_endpoint(self):
        calls = []

        def fake_api(command, session_id=None, **parameters):
            calls.append((command, parameters))
            if command == "get-session":
                return {"sessionId": "test-session"}
            return {"data": "25\tgå\n10\thus\n3\thjem\n"}

        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.object(
            export_clarino_frequency, "api", side_effect=fake_api
        ):
            output = Path(temp_dir) / "frequency.tsv"
            export_clarino_frequency.export_frequency_list(output, 3)

            export_call = next(
                parameters
                for command, parameters in calls
                if command == "get-attribute-values"
            )
            self.assertEqual(export_call["corpus"], "avis-plain")
            self.assertEqual(export_call["attribute"], "word")
            self.assertEqual(export_call["sort-key"], "frequency")
            self.assertEqual(export_call["end"], 3)
            data_rows = [
                line
                for line in output.read_text(encoding="utf-8").splitlines()
                if not line.startswith("#")
            ]
            self.assertEqual(data_rows, ["25\tgå", "10\thus", "3\thjem"])

    def test_parser_accepts_value_then_count_downloads(self):
        self.assertEqual(
            export_clarino_frequency.parse_download("hus\t10\ngå\t25\n", 10),
            [(10, "hus"), (25, "gå")],
        )


if __name__ == "__main__":
    unittest.main()
