from __future__ import annotations

import sys
import unittest
from pathlib import Path


EDITOR_ROOT = Path(__file__).resolve().parents[1]
if str(EDITOR_ROOT) not in sys.path:
    sys.path.insert(0, str(EDITOR_ROOT))

from backend.project_data import discover_project_root, export_config_text, get_fixture_payload, preview_pixelinfo_expression


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
        self.assertGreater(len(self.sample_payload["fixtureLibrary"]), 0)
        self.assertGreater(len(self.sample_payload["groupDefinitions"]), 0)
        self.assertGreater(len(self.sample_payload["pixelFunctionLibrary"]), 0)
        self.assertGreater(len(self.sample_payload["availableConfigFiles"]), 0)
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
        fixtures = []
        for fixture in self.sample_payload["fixtures"]:
            editable_fields = dict(fixture["editableFields"])
            position = list(fixture["position"])
            orientation = list(fixture["orientation"])
            if fixture["id"] == self.sample_fixture["id"]:
                position = [1.25, 2.5, 3.75]
                orientation = [0.0, 0.0, 0.0, 1.0]
                if "artnet_in_universe" in editable_fields:
                    editable_fields["artnet_in_universe"] = "999"

            fixtures.append(
                {
                    "id": fixture["id"],
                    "group": fixture["group"],
                    "position": position,
                    "orientation": orientation,
                    "editableFields": editable_fields,
                    "editableFieldOrder": list(fixture["editableFieldOrder"]),
                }
            )

        content = export_config_text(
            self.project_root,
            fixtures,
            self.sample_payload["groupDefinitions"],
        )
        self.assertIn('"position": [1.25, 2.5, 3.75]', content)
        self.assertIn('Quaternion([0.0, 0.0, 0.0, 1.0])', content)
        if "artnet_in_universe" in self.sample_fixture["editableFields"]:
            self.assertIn('"artnet_in_universe": 999', content)

    def test_export_supports_added_and_removed_fixture_groups(self) -> None:
        single_fixture_groups = [
            group_definition["name"]
            for group_definition in self.sample_payload["groupDefinitions"]
            if sum(1 for fixture in self.sample_payload["fixtures"] if fixture["group"] == group_definition["name"]) == 1
        ]
        self.assertGreater(len(single_fixture_groups), 0)
        removed_group = single_fixture_groups[0]

        template = self.sample_payload["fixtureLibrary"][0]
        new_group_name = "FixtureLibraryTest"
        template_group_definition = next(
            group_definition
            for group_definition in self.sample_payload["groupDefinitions"]
            if group_definition["name"] == template["group"]
        )
        new_group_definition = {
            "name": new_group_name,
            "fieldOrder": list(template_group_definition["fieldOrder"]),
            "fields": dict(template_group_definition["fields"]),
        }
        if "arrangement" in new_group_definition["fields"]:
            new_group_definition["fields"]["arrangement"] = "[1]"

        new_editable_fields = dict(template["editableFields"])
        if "name" in new_editable_fields:
            new_editable_fields["name"] = '"Fixture Library Test 1"'

        fixtures = [
            {
                "id": fixture["id"],
                "group": fixture["group"],
                "position": list(fixture["position"]),
                "orientation": list(fixture["orientation"]),
                "editableFields": dict(fixture["editableFields"]),
                "editableFieldOrder": list(fixture["editableFieldOrder"]),
            }
            for fixture in self.sample_payload["fixtures"]
            if fixture["group"] != removed_group
        ]
        fixtures.append(
            {
                "id": "added:test-fixture",
                "group": new_group_name,
                "position": [6.5, -2.0, 1.75],
                "orientation": [0.0, 0.0, 0.0, 1.0],
                "editableFields": new_editable_fields,
                "editableFieldOrder": list(template["editableFieldOrder"]),
            }
        )

        content = export_config_text(
            self.project_root,
            fixtures,
            [*self.sample_payload["groupDefinitions"], new_group_definition],
        )
        self.assertNotIn(f'"{removed_group}": {{', content)
        self.assertIn(f'"{new_group_name}": {{', content)
        self.assertIn('"position": [6.5, -2.0, 1.75]', content)

    def test_pixel_preview_evaluates_pixelinfo_expression(self) -> None:
        preview = preview_pixelinfo_expression(self.project_root, "TriBar.make3()")
        self.assertGreater(preview["pointCount"], 0)
        self.assertEqual(preview["pointCount"], len(preview["points"]))
        self.assertIsNotNone(preview["bounds"])

    def test_loads_alternate_show_file(self) -> None:
        alternate_show = None
        payload = None
        for entry in self.sample_payload["availableConfigFiles"]:
            if entry.get("isDefault") or str(entry.get("label", "")).endswith(".py"):
                continue
            try:
                payload = get_fixture_payload(self.project_root, entry["path"])
                alternate_show = entry
                break
            except Exception:
                continue

        if alternate_show is None or payload is None:
            self.skipTest("No alternate non-.py show file loaded successfully from config/")

        self.assertEqual(Path(payload["configPath"]).resolve(), Path(alternate_show["path"]).resolve())
        self.assertEqual(payload["configLabel"], alternate_show["relativePath"])
        self.assertGreater(len(payload["fixtures"]), 0)
        self.assertTrue(str(payload["defaultOutputPath"]).endswith(".edited.py"))


if __name__ == "__main__":
    unittest.main()
