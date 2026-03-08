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

    def test_loads_current_fixtures(self) -> None:
        payload = get_fixture_payload(self.project_root)
        fixture_ids = {fixture["id"] for fixture in payload["fixtures"]}
        self.assertIn("Monitor:0", fixture_ids)
        self.assertGreater(len(payload["fixtures"]), 0)

    def test_export_rewrites_fixture_transform(self) -> None:
        content = export_config_text(
            self.project_root,
            [
                {
                    "id": "Monitor:0",
                    "position": [1.25, 2.5, 3.75],
                    "orientation": [0.0, 0.0, 0.0, 1.0],
                }
            ],
        )
        self.assertIn('"position": [1.25, 2.5, 3.75]', content)
        self.assertIn('"orientation": Quaternion([0.0, 0.0, 0.0, 1.0])', content)


if __name__ == "__main__":
    unittest.main()
