from __future__ import annotations

import ast
import importlib
import inspect
import os
import sys
from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Iterable


CONFIG_RELATIVE_PATH = Path("config/controllables.py")
DEFAULT_OUTPUT_RELATIVE_PATH = Path("config/controllables.edited.py")
PIXEL_DEVICES_RELATIVE_PATH = Path("scene/pixel_devices")
EDITABLE_FIELD_NAMES = [
    "name",
    "type",
    "tags",
    "artnet_in_universe",
    "artnet_out_mapping",
    "dmx_out",
    "pixelinfo",
]


@dataclass(frozen=True)
class SourceRange:
    start: int
    end: int


@dataclass(frozen=True)
class FixtureSourceRef:
    group_name: str
    index: int
    position_range: SourceRange
    orientation_range: SourceRange
    editable_fields: dict[str, SourceRange]
    editable_field_order: list[str]


@dataclass(frozen=True)
class GroupSourceRef:
    name: str
    field_ranges: dict[str, SourceRange]
    field_order: list[str]


@dataclass(frozen=True)
class ParsedSource:
    groups_assignment_range: SourceRange
    group_refs: dict[str, GroupSourceRef]
    fixture_refs: dict[tuple[str, int], FixtureSourceRef]


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


def _range_for_node(offsets: list[int], node: ast.AST) -> SourceRange:
    return SourceRange(
        start=_absolute_offset(offsets, node.lineno, node.col_offset),
        end=_absolute_offset(offsets, node.end_lineno, node.end_col_offset),
    )


def _dict_entries(node: ast.Dict) -> dict[str, ast.AST]:
    result: dict[str, ast.AST] = {}
    for key_node, value_node in zip(node.keys, node.values):
        if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str):
            result[key_node.value] = value_node
    return result


def parse_source_refs(source_text: str) -> ParsedSource:
    tree = ast.parse(source_text)
    offsets = _line_offsets(source_text)
    groups_node: ast.Dict | None = None
    groups_assignment_range: SourceRange | None = None

    for statement in tree.body:
        if not isinstance(statement, ast.Assign):
            continue
        for target in statement.targets:
            if isinstance(target, ast.Name) and target.id == "groups" and isinstance(statement.value, ast.Dict):
                groups_node = statement.value
                groups_assignment_range = _range_for_node(offsets, statement)
                break
        if groups_node is not None:
            break

    if groups_node is None or groups_assignment_range is None:
        raise ValueError("Could not find groups assignment in controllables.py")

    group_refs: dict[str, GroupSourceRef] = {}
    fixture_refs: dict[tuple[str, int], FixtureSourceRef] = {}
    for group_key, group_value in zip(groups_node.keys, groups_node.values):
        if not (
            isinstance(group_key, ast.Constant)
            and isinstance(group_key.value, str)
            and isinstance(group_value, ast.Dict)
        ):
            continue

        entries = _dict_entries(group_value)
        group_field_ranges: dict[str, SourceRange] = {}
        group_field_order: list[str] = []
        for key_node, value_node in zip(group_value.keys, group_value.values):
            if not (isinstance(key_node, ast.Constant) and isinstance(key_node.value, str)):
                continue
            key_name = key_node.value
            if key_name == "controllables":
                continue
            group_field_order.append(key_name)
            group_field_ranges[key_name] = _range_for_node(offsets, value_node)
        group_refs[group_key.value] = GroupSourceRef(
            name=group_key.value,
            field_ranges=group_field_ranges,
            field_order=group_field_order,
        )

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

            editable_fields: dict[str, SourceRange] = {}
            editable_field_order: list[str] = []
            for key_node, value_node in zip(item_node.keys, item_node.values):
                if not (isinstance(key_node, ast.Constant) and isinstance(key_node.value, str)):
                    continue
                key_name = key_node.value
                if key_name not in EDITABLE_FIELD_NAMES:
                    continue
                editable_field_order.append(key_name)
                editable_fields[key_name] = _range_for_node(offsets, value_node)

            fixture_refs[(group_key.value, index)] = FixtureSourceRef(
                group_name=group_key.value,
                index=index,
                position_range=_range_for_node(offsets, position_node),
                orientation_range=_range_for_node(offsets, orientation_node),
                editable_fields=editable_fields,
                editable_field_order=editable_field_order,
            )

    return ParsedSource(
        groups_assignment_range=groups_assignment_range,
        group_refs=group_refs,
        fixture_refs=fixture_refs,
    )


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


def _emit_progress(progress_callback, percent: int, message: str) -> None:
    if progress_callback is not None:
        progress_callback(percent, message)


def _source_value(source_text: str, source_range: SourceRange) -> str:
    return source_text[source_range.start:source_range.end]


def _group_definition_payload(source_text: str, group_ref: GroupSourceRef | None, group_name: str) -> dict[str, object]:
    fields: dict[str, str] = {}
    field_order: list[str] = []
    if group_ref is not None:
        field_order = list(group_ref.field_order)
        for field_name in field_order:
            fields[field_name] = _source_value(source_text, group_ref.field_ranges[field_name])

    return {
        "name": group_name,
        "fields": fields,
        "fieldOrder": field_order,
    }


def _fixture_library_entry(fixture: dict[str, object]) -> dict[str, object]:
    library_entry = {
        "key": f"template:{fixture['id']}",
        "label": fixture["name"],
        "group": fixture["group"],
        "kind": fixture["kind"],
        "role": fixture["role"],
        "position": list(fixture["position"]),
        "orientation": list(fixture["orientation"]),
        "pointCount": fixture["pointCount"],
        "editableFields": dict(fixture["editableFields"]),
        "editableFieldOrder": list(fixture["editableFieldOrder"]),
    }
    if "points" in fixture:
        library_entry["points"] = [list(point) for point in fixture["points"]]
    return library_entry


def _pixel_expression_prefix(expression: str) -> tuple[str, str] | None:
    match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\.(make[A-Za-z0-9_]*)\s*\(", expression)
    if not match:
        return None
    return match.group(1), match.group(2)


def _placeholder_argument_text(parameter_name: str) -> str:
    name = parameter_name.lower()
    if "pitch" in name:
        return "0.04"
    if "sep" in name or "spacing" in name:
        return "0.5"
    if "width" in name:
        return "8"
    if "height" in name or "hight" in name:
        return "8"
    if "col_count" in name:
        return "4"
    if "row_count" in name:
        return "2"
    if name in {"n", "l"}:
        return "6" if name == "n" else "48"
    if "nled" in name:
        return "48"
    if "seg" in name:
        return "3"
    if "dir" in name or "edge" in name:
        return "1"
    if "rot" in name or "offset" in name:
        return "0"
    if "radius" in name:
        return "1.0"
    if "flip" in name or "mirror" in name or "row_first" in name:
        return "False"
    return "1"


def _python_literal(value: object) -> str:
    return repr(value)


def _parameter_payload(parameter: inspect.Parameter) -> dict[str, object]:
    has_default = parameter.default is not inspect.Signature.empty
    return {
        "name": parameter.name,
        "kind": parameter.kind.name,
        "hasDefault": has_default,
        "default": _python_literal(parameter.default) if has_default else None,
    }


def _build_function_expression(module_name: str, function_name: str, signature: inspect.Signature) -> str:
    arguments: list[str] = []
    for parameter in signature.parameters.values():
        if parameter.kind in {inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD}:
            continue

        if parameter.default is inspect.Signature.empty:
            value = _placeholder_argument_text(parameter.name)
        else:
            value = _python_literal(parameter.default)

        if parameter.kind == inspect.Parameter.KEYWORD_ONLY:
            arguments.append(f"{parameter.name}={value}")
        else:
            arguments.append(value)

    return f"{module_name}.{function_name}(" + ", ".join(arguments) + ")"


def _extract_pixel_expression_examples(source_text: str) -> dict[tuple[str, str], list[str]]:
    parsed_source = parse_source_refs(source_text)
    examples: dict[tuple[str, str], list[str]] = {}
    for fixture_ref in parsed_source.fixture_refs.values():
        pixelinfo_range = fixture_ref.editable_fields.get("pixelinfo")
        if pixelinfo_range is None:
            continue
        expression = _source_value(source_text, pixelinfo_range).strip()
        prefix = _pixel_expression_prefix(expression)
        if prefix is None:
            continue
        expressions = examples.setdefault(prefix, [])
        if expression not in expressions:
            expressions.append(expression)
    return examples


def _pixel_device_modules(project_root: Path) -> dict[str, object]:
    bootstrap_project(project_root)
    modules: dict[str, object] = {}
    device_dir = project_root / PIXEL_DEVICES_RELATIVE_PATH
    for module_path in sorted(device_dir.glob("*.py")):
        if module_path.name.startswith("_"):
            continue
        module_name = module_path.stem
        try:
            modules[module_name] = importlib.import_module(f"scene.pixel_devices.{module_name}")
        except Exception:
            continue
    return modules


def get_pixel_function_library(project_root: Path, source_text: str | None = None) -> list[dict[str, object]]:
    project_root = project_root.resolve()
    if source_text is None:
        source_text = (project_root / CONFIG_RELATIVE_PATH).read_text(encoding="utf-8")

    examples_by_prefix = _extract_pixel_expression_examples(source_text)
    functions: list[dict[str, object]] = []
    for module_name, module in _pixel_device_modules(project_root).items():
        for function_name, function in inspect.getmembers(module, inspect.isfunction):
            if not function_name.startswith("make"):
                continue
            if function.__module__ != module.__name__:
                continue

            signature = inspect.signature(function)
            prefix = (module_name, function_name)
            suggested_expression = (
                examples_by_prefix.get(prefix, [None])[0]
                or _build_function_expression(module_name, function_name, signature)
            )
            functions.append(
                {
                    "key": f"{module_name}:{function_name}",
                    "module": module_name,
                    "function": function_name,
                    "label": f"{module_name}.{function_name}",
                    "signature": str(signature),
                    "parameters": [_parameter_payload(parameter) for parameter in signature.parameters.values()],
                    "examples": examples_by_prefix.get(prefix, []),
                    "suggestedExpression": suggested_expression,
                }
            )

    return sorted(functions, key=lambda item: (str(item["module"]).lower(), str(item["function"]).lower()))


def preview_pixelinfo_expression(project_root: Path, expression: str) -> dict[str, object]:
    project_root = project_root.resolve()
    source_text = (project_root / CONFIG_RELATIVE_PATH).read_text(encoding="utf-8")
    bootstrap_project(project_root)
    globals_dict = {"__builtins__": {}}
    globals_dict.update(_pixel_device_modules(project_root))

    if not expression.strip():
        return {
            "expression": expression,
            "pointCount": 0,
            "points": [],
            "bounds": None,
            "pixelFunctionLibrary": get_pixel_function_library(project_root, source_text),
        }

    result = eval(expression, globals_dict, {})
    points = _fixture_points(result)
    bounds = None
    if points:
        mins = [min(point[index] for point in points) for index in range(3)]
        maxs = [max(point[index] for point in points) for index in range(3)]
        bounds = {"min": mins, "max": maxs}

    return {
        "expression": expression,
        "pointCount": len(points),
        "points": points,
        "bounds": bounds,
        "pixelFunctionLibrary": get_pixel_function_library(project_root, source_text),
    }


def get_fixture_payload(project_root: Path, progress_callback=None) -> dict[str, object]:
    project_root = project_root.resolve()
    _emit_progress(progress_callback, 5, "Reading controllables.py")
    source_text = (project_root / CONFIG_RELATIVE_PATH).read_text(encoding="utf-8")
    _emit_progress(progress_callback, 15, "Parsing fixture source")
    parsed_source = parse_source_refs(source_text)
    _emit_progress(progress_callback, 25, "Inspecting pixel devices")
    pixel_function_library = get_pixel_function_library(project_root, source_text)
    _emit_progress(progress_callback, 35, "Importing runtime config")
    config_controllables = load_runtime_config(project_root)

    fixtures: list[dict[str, object]] = []
    fixture_library: list[dict[str, object]] = []
    group_definitions: list[dict[str, object]] = []
    total_items = sum(len(group_data["controllables"]) for group_data in config_controllables.groups.values())
    processed_items = 0
    for group_name, group_data in config_controllables.groups.items():
        group_definitions.append(
            _group_definition_payload(source_text, parsed_source.group_refs.get(group_name), group_name)
        )
        _emit_progress(progress_callback, 40, f"Loading group {group_name}")
        for index, item in enumerate(group_data["controllables"]):
            processed_items += 1
            if (group_name, index) not in parsed_source.fixture_refs:
                continue

            orientation = item["orientation"]
            source_ref = parsed_source.fixture_refs[(group_name, index)]
            editable_fields = {}
            for field_name in source_ref.editable_field_order:
                field_range = source_ref.editable_fields[field_name]
                editable_fields[field_name] = source_text[field_range.start:field_range.end]
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
                "editableFields": editable_fields,
                "editableFieldOrder": source_ref.editable_field_order,
            }

            if "pixelinfo" in item:
                fixture["points"] = _fixture_points(item["pixelinfo"])

            fixtures.append(fixture)
            fixture_library.append(_fixture_library_entry(fixture))
            percent = 40 + int((processed_items / max(total_items, 1)) * 55)
            _emit_progress(progress_callback, min(percent, 95), f"Loaded {fixture['name']}")

    payload = {
        "projectRoot": str(project_root),
        "configPath": str(project_root / CONFIG_RELATIVE_PATH),
        "defaultOutputPath": str(project_root / DEFAULT_OUTPUT_RELATIVE_PATH),
        "roomBounds": {
            "min": [-8.0, -17.0, 0.0],
            "max": [8.0, 8.0, 7.5],
        },
        "fixtures": fixtures,
        "fixtureLibrary": fixture_library,
        "groupDefinitions": group_definitions,
        "pixelFunctionLibrary": pixel_function_library,
    }
    _emit_progress(progress_callback, 100, f"Loaded {len(fixtures)} fixtures")
    return payload


def _normalize_group_definitions(
    group_definitions: Iterable[dict[str, object]] | None,
    source_text: str,
    parsed_source: ParsedSource,
) -> tuple[list[str], dict[str, dict[str, object]]]:
    order: list[str] = []
    definitions: dict[str, dict[str, object]] = {}

    for group_name, group_ref in parsed_source.group_refs.items():
        payload = _group_definition_payload(source_text, group_ref, group_name)
        order.append(group_name)
        definitions[group_name] = payload

    if group_definitions is None:
        return order, definitions

    order = []
    definitions = {}
    for group_definition in group_definitions:
        group_name = str(group_definition.get("name", "")).strip()
        if not group_name:
            raise ValueError("Group definition is missing a name")

        raw_fields = group_definition.get("fields", {})
        if not isinstance(raw_fields, dict):
            raise ValueError(f"Group {group_name} fields must be a dictionary")
        fields: dict[str, str] = {}
        for field_name, field_value in raw_fields.items():
            if not isinstance(field_name, str) or field_name == "controllables":
                continue
            if not isinstance(field_value, str):
                raise ValueError(f"Group {group_name} field {field_name} must be a string")
            fields[field_name] = field_value

        raw_order = group_definition.get("fieldOrder", [])
        if not isinstance(raw_order, list):
            raise ValueError(f"Group {group_name} fieldOrder must be a list")
        field_order = [field_name for field_name in raw_order if field_name in fields]
        for field_name in fields:
            if field_name not in field_order:
                field_order.append(field_name)

        order.append(group_name)
        definitions[group_name] = {
            "name": group_name,
            "fields": fields,
            "fieldOrder": field_order,
        }

    return order, definitions


def _group_name_for_fixture(fixture: dict[str, object]) -> str:
    group_name = fixture.get("group")
    if isinstance(group_name, str) and group_name.strip():
        return group_name

    fixture_id = str(fixture.get("id", ""))
    if ":" in fixture_id:
        return fixture_id.split(":", 1)[0]

    raise ValueError(f"Fixture is missing a group: {fixture_id or fixture}")


def _ordered_fields(field_order: Iterable[str], fields: dict[str, str]) -> list[str]:
    ordered = [field_name for field_name in field_order if field_name in fields]
    for field_name in fields:
        if field_name not in ordered:
            ordered.append(field_name)
    return ordered


def _normalized_fixture_payload(fixture: dict[str, object]) -> dict[str, object]:
    fixture_id = str(fixture.get("id", ""))
    position = [float(value) for value in fixture["position"]]
    orientation = [float(value) for value in fixture["orientation"]]
    if len(position) != 3:
        raise ValueError(f"Fixture {fixture_id} has invalid position length")
    if len(orientation) != 4:
        raise ValueError(f"Fixture {fixture_id} has invalid orientation length")

    raw_editable_fields = fixture.get("editableFields", {})
    if not isinstance(raw_editable_fields, dict):
        raise ValueError(f"Fixture {fixture_id} editableFields must be a dictionary")
    editable_fields: dict[str, str] = {}
    for field_name, field_value in raw_editable_fields.items():
        if not isinstance(field_name, str):
            continue
        if not isinstance(field_value, str):
            raise ValueError(f"Fixture {fixture_id} field {field_name} must be a string")
        editable_fields[field_name] = field_value

    raw_field_order = fixture.get("editableFieldOrder", [])
    if not isinstance(raw_field_order, list):
        raw_field_order = []

    return {
        "id": fixture_id,
        "group": _group_name_for_fixture(fixture),
        "position": position,
        "orientation": orientation,
        "editableFields": editable_fields,
        "editableFieldOrder": [field_name for field_name in raw_field_order if field_name in editable_fields],
    }


def _format_fixture_block(fixture: dict[str, object]) -> str:
    lines = [
        "            {",
        f'                "position": {_format_vector(fixture["position"])},',
        f'                "orientation": {_format_quaternion(fixture["orientation"])},',
    ]
    editable_fields = fixture["editableFields"]
    for field_name in _ordered_fields(fixture["editableFieldOrder"], editable_fields):
        lines.append(f"                {json.dumps(field_name)}: {editable_fields[field_name]},")
    lines.append("            },")
    return "\n".join(lines)


def _format_group_block(group_definition: dict[str, object], fixtures: list[dict[str, object]]) -> str:
    group_name = str(group_definition["name"])
    fields = dict(group_definition.get("fields", {}))
    field_order = list(group_definition.get("fieldOrder", []))

    lines = [f"    {json.dumps(group_name)}: {{"]
    for field_name in _ordered_fields(field_order, fields):
        lines.append(f"        {json.dumps(field_name)}: {fields[field_name]},")

    lines.append('        "controllables": [')
    for fixture in fixtures:
        lines.append(_format_fixture_block(fixture))
    lines.append("        ]")
    lines.append("    },")
    return "\n".join(lines)


def _format_groups_assignment(
    grouped_fixtures: dict[str, list[dict[str, object]]],
    group_order: list[str],
    group_definitions_by_name: dict[str, dict[str, object]],
) -> str:
    ordered_names = [group_name for group_name in group_order if grouped_fixtures.get(group_name)]
    for group_name in grouped_fixtures:
        if group_name not in group_definitions_by_name:
            group_definitions_by_name[group_name] = {
                "name": group_name,
                "fields": {},
                "fieldOrder": [],
            }
        if group_name not in ordered_names:
            ordered_names.append(group_name)

    if not ordered_names:
        return "groups = {}\n"

    blocks = [
        _format_group_block(group_definitions_by_name[group_name], grouped_fixtures[group_name])
        for group_name in ordered_names
    ]
    return "groups = {\n\n" + "\n\n".join(blocks) + "\n}\n"


def export_config_text(
    project_root: Path,
    fixtures: Iterable[dict[str, object]],
    group_definitions: Iterable[dict[str, object]] | None = None,
) -> str:
    project_root = project_root.resolve()
    source_path = project_root / CONFIG_RELATIVE_PATH
    source_text = source_path.read_text(encoding="utf-8")
    parsed_source = parse_source_refs(source_text)
    group_order, group_definitions_by_name = _normalize_group_definitions(group_definitions, source_text, parsed_source)

    normalized_fixtures = [_normalized_fixture_payload(fixture) for fixture in fixtures]
    grouped_fixtures: dict[str, list[dict[str, object]]] = {}
    for fixture in normalized_fixtures:
        grouped_fixtures.setdefault(fixture["group"], []).append(fixture)

    groups_assignment = _format_groups_assignment(grouped_fixtures, group_order, group_definitions_by_name)
    assignment_range = parsed_source.groups_assignment_range
    return source_text[:assignment_range.start] + groups_assignment + source_text[assignment_range.end:]


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
