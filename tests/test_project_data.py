from __future__ import annotations

import sys
import unittest
from pathlib import Path


EDITOR_ROOT = Path(__file__).resolve().parents[1]
if str(EDITOR_ROOT) not in sys.path:
    sys.path.insert(0, str(EDITOR_ROOT))

from backend.project_data import discover_project_root, export_config_text, get_fixture_payload


class ProjectDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.project_root = discover_project_root(Path.cwd())
        cls.sample_payload = get_fixture_payload(cls.project_root)
        cls.sample_fixture = cls.sample_payload["fixtures"][0]

    def test_loads_current_fixtures(self) -> None:
        fixture_ids = {fixture["id"] for fixture in self.sample_payload["fixtures"]}
        self.assertIn(self.sample_fixture["id"], fixture_ids)
        self.assertGreater(len(self.sample_payload["fixtures"]), 0)
        self.assertGreater(len(self.sample_fixture["editableFields"]), 0)

    def test_loads_current_fixtures_with_progress(self) -> None:
        progress_updates = []

        def progress_callback(percent, message):
            progress_updates.append((percent, message))

        payload = get_fixture_payload(self.project_root, progress_callback=progress_callback)
        self.assertGreater(len(progress_updates), 0)
        self.assertEqual(progress_updates[-1][0], 100)
        self.assertGreater(len(payload["fixtures"]), 0)

    def test_export_rewrites_fixture_transform(self) -> None:
        editable_fields = dict(self.sample_fixture["editableFields"])
        if "artnet_in_universe" in editable_fields:
            editable_fields["artnet_in_universe"] = "999"

        content = export_config_text(
            self.project_root,
            [
                {
                    "id": self.sample_fixture["id"],
                    "position": [1.25, 2.5, 3.75],
                    "orientation": [0.0, 0.0, 0.0, 1.0],
                    "editableFields": editable_fields,
                }
            ],
        )
        self.assertIn('"position": [1.25, 2.5, 3.75]', content)
        self.assertIn('Quaternion([0.0, 0.0, 0.0, 1.0])', content)
        if "artnet_in_universe" in editable_fields:
            self.assertIn('"artnet_in_universe": 999', content)


if __name__ == "__main__":
    unittest.main()
