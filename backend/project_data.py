from __future__ import annotations

import ast
import importlib
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


CONFIG_RELATIVE_PATH = Path("config/controllables.py")
DEFAULT_OUTPUT_RELATIVE_PATH = Path("config/controllables.edited.py")


@dataclass(frozen=True)
class FixtureSourceRef:
    group_name: str
    index: int
    position_start: int
    position_end: int
    orientation_start: int
    orientation_end: int


def discover_project_root(anchor: Path | None = None) -> Path:
    env_root = os.environ.get("LIGHTCONTROL_PROJECT_ROOT")
    candidates: list[Path] = []

    if env_root:
        candidates.append(Path(env_root).resolve())

    if anchor is not None:
        anchor_path = Path(anchor).resolve()
        current = anchor_path if anchor_path.is_dir() else anchor_path.parent
        candidates.extend([current, *current.parents])

    cwd = Path.cwd().resolve()
    candidates.extend([cwd, *cwd.parents])

    module_dir = Path(__file__).resolve().parent
    candidates.extend([module_dir, *module_dir.parents])

    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if (candidate / CONFIG_RELATIVE_PATH).exists():
            return candidate

    raise FileNotFoundError("Could not locate lightcontrol project root")


def bootstrap_project(project_root: Path) -> None:
    project_root = project_root.resolve()
    ext_dir = project_root / "ext"

    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    if ext_dir.exists():
        if str(ext_dir) not in sys.path:
            sys.path.insert(0, str(ext_dir))
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(ext_dir))


def _reload_config_modules() -> None:
    for module_name in list(sys.modules):
        if module_name == "config" or module_name.startswith("config."):
            del sys.modules[module_name]


def load_runtime_config(project_root: Path):
    bootstrap_project(project_root)
    _reload_config_modules()
    config = importlib.import_module("config")
    return config.controllables


def _line_offsets(source_text: str) -> list[int]:
    offsets = [0]
    running = 0
    for line in source_text.splitlines(keepends=True):
        running += len(line)
        offsets.append(running)
    return offsets


def _absolute_offset(offsets: list[int], line: int, column: int) -> int:
    return offsets[line - 1] + column


def _dict_entries(node: ast.Dict) -> dict[str, ast.AST]:
    result: dict[str, ast.AST] = {}
    for key_node, value_node in zip(node.keys, node.values):
        if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str):
            result[key_node.value] = value_node
    return result


def parse_source_refs(source_text: str) -> dict[tuple[str, int], FixtureSourceRef]:
    tree = ast.parse(source_text)
    offsets = _line_offsets(source_text)
    groups_node: ast.Dict | None = None

    for statement in tree.body:
        if not isinstance(statement, ast.Assign):
            continue
        for target in statement.targets:
            if isinstance(target, ast.Name) and target.id == "groups" and isinstance(statement.value, ast.Dict):
                groups_node = statement.value
                break
        if groups_node is not None:
            break

    if groups_node is None:
        raise ValueError("Could not find groups assignment in controllables.py")

    refs: dict[tuple[str, int], FixtureSourceRef] = {}
    for group_key, group_value in zip(groups_node.keys, groups_node.values):
        if not (
            isinstance(group_key, ast.Constant)
            and isinstance(group_key.value, str)
            and isinstance(group_value, ast.Dict)
        ):
            continue

        entries = _dict_entries(group_value)
        controllables_node = entries.get("controllables")
        if not isinstance(controllables_node, ast.List):
            continue

        for index, item_node in enumerate(controllables_node.elts):
            if not isinstance(item_node, ast.Dict):
                continue
            item_entries = _dict_entries(item_node)
            position_node = item_entries.get("position")
            orientation_node = item_entries.get("orientation")
            if position_node is None or orientation_node is None:
                continue

            refs[(group_key.value, index)] = FixtureSourceRef(
                group_name=group_key.value,
                index=index,
                position_start=_absolute_offset(offsets, position_node.lineno, position_node.col_offset),
                position_end=_absolute_offset(offsets, position_node.end_lineno, position_node.end_col_offset),
                orientation_start=_absolute_offset(offsets, orientation_node.lineno, orientation_node.col_offset),
                orientation_end=_absolute_offset(offsets, orientation_node.end_lineno, orientation_node.end_col_offset),
            )

    return refs


def _clean_number(value: float, precision: int = 8) -> str:
    if abs(value) < 1e-10:
        value = 0.0
    text = f"{float(value):.{precision}f}".rstrip("0").rstrip(".")
    if text in {"", "-0"}:
        text = "0"
    if "." not in text:
        text += ".0"
    return text


def _format_vector(values: Iterable[float], precision: int = 6) -> str:
    return "[" + ", ".join(_clean_number(value, precision) for value in values) + "]"


def _format_quaternion(values: Iterable[float]) -> str:
    return "Quaternion(" + _format_vector(values, precision=10) + ")"


def _fixture_points(pixelinfo: Iterable[object]) -> list[list[float]]:
    points: list[list[float]] = []
    for pixel in pixelinfo:
        points.append([
            float(pixel.pos.x),
            float(pixel.pos.y),
            float(pixel.pos.z),
        ])
    return points


def get_fixture_payload(project_root: Path) -> dict[str, object]:
    project_root = project_root.resolve()
    source_text = (project_root / CONFIG_RELATIVE_PATH).read_text(encoding="utf-8")
    refs = parse_source_refs(source_text)
    config_controllables = load_runtime_config(project_root)

    fixtures: list[dict[str, object]] = []
    for group_name, group_data in config_controllables.groups.items():
        for index, item in enumerate(group_data["controllables"]):
            if (group_name, index) not in refs:
                continue

            orientation = item["orientation"]
            fixture = {
                "id": f"{group_name}:{index}",
                "group": group_name,
                "index": index,
                "name": item["name"],
                "role": item.get("role", group_data.get("role", "")),
                "kind": "synth" if "pixelinfo" in item else "conventional",
                "position": [float(axis) for axis in item["position"]],
                "orientation": [
                    float(orientation.x),
                    float(orientation.y),
                    float(orientation.z),
                    float(orientation.w),
                ],
                "tags": list(item.get("tags", [])),
                "type": item.get("type"),
                "artnetInUniverse": item.get("artnet_in_universe"),
                "dmxOut": list(item["dmx_out"]) if "dmx_out" in item else None,
                "pointCount": len(item["pixelinfo"]) if "pixelinfo" in item else 0,
            }

            if "pixelinfo" in item:
                fixture["points"] = _fixture_points(item["pixelinfo"])

            fixtures.append(fixture)

    return {
        "projectRoot": str(project_root),
        "configPath": str(project_root / CONFIG_RELATIVE_PATH),
        "defaultOutputPath": str(project_root / DEFAULT_OUTPUT_RELATIVE_PATH),
        "roomBounds": {
            "min": [-8.0, -17.0, 0.0],
            "max": [8.0, 8.0, 7.5],
        },
        "fixtures": fixtures,
    }


def export_config_text(project_root: Path, fixtures: Iterable[dict[str, object]]) -> str:
    project_root = project_root.resolve()
    source_path = project_root / CONFIG_RELATIVE_PATH
    source_text = source_path.read_text(encoding="utf-8")
    refs = parse_source_refs(source_text)

    replacements: list[tuple[int, int, str]] = []
    for fixture in fixtures:
        fixture_id = str(fixture["id"])
        try:
            group_name, index_text = fixture_id.split(":", 1)
            key = (group_name, int(index_text))
        except ValueError as exc:
            raise ValueError(f"Invalid fixture id: {fixture_id}") from exc

        if key not in refs:
            raise KeyError(f"Fixture not found in source: {fixture_id}")

        position = [float(value) for value in fixture["position"]]
        orientation = [float(value) for value in fixture["orientation"]]
        if len(position) != 3:
            raise ValueError(f"Fixture {fixture_id} has invalid position length")
        if len(orientation) != 4:
            raise ValueError(f"Fixture {fixture_id} has invalid orientation length")

        ref = refs[key]
        replacements.append((ref.position_start, ref.position_end, _format_vector(position)))
        replacements.append((ref.orientation_start, ref.orientation_end, _format_quaternion(orientation)))

    rewritten = source_text
    for start, end, replacement in sorted(replacements, key=lambda item: item[0], reverse=True):
        rewritten = rewritten[:start] + replacement + rewritten[end:]

    return rewritten


def write_export(project_root: Path, content: str, output_path: str | None) -> str | None:
    if not output_path:
        return None

    project_root = project_root.resolve()
    output = Path(output_path)
    if not output.is_absolute():
        output = project_root / output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(content, encoding="utf-8")
    return str(output.resolve())
