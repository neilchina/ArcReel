"""new_assets 处理决定的解析闸门：decision 与字段必须自洽，混用形态判违约。"""

from __future__ import annotations

from typing import Any

import pytest

from lib.script.plan_new_assets import NewAssetsError, resolve_new_assets


def _project(characters: dict[str, Any]) -> dict[str, Any]:
    return {"characters": characters}


class TestRegisterDecision:
    def test_register_with_target_is_rejected(self) -> None:
        """register 独立登记新资产、不读 target；换装误用 register+target 必须判违约而非静默独立登记。"""
        project = _project({"林远": {"description": "本体"}})
        items = [
            {
                "type": "character",
                "name": "林远家居服",
                "decision": "register",
                "reason": "换装",
                "target": "林远",
                "asset_name": "林远家居服",
            }
        ]
        with pytest.raises(NewAssetsError) as excinfo:
            resolve_new_assets(project, items)
        assert [p.code for p in excinfo.value.problems] == ["new_asset_register_with_target"]

    def test_register_without_target_still_registers(self) -> None:
        project = _project({"林远": {"description": "本体"}})
        items = [
            {
                "type": "character",
                "name": "路人甲",
                "decision": "register",
                "reason": "新出场",
                "asset_name": "路人甲",
            }
        ]
        resolution = resolve_new_assets(project, items)
        assert list(resolution.registrations.get("character", {})) == ["路人甲"]

    def test_derivative_with_target_still_resolves(self) -> None:
        project = _project({"林远": {"description": "本体"}})
        items = [
            {
                "type": "character",
                "name": "家居服",
                "decision": "derivative",
                "reason": "换装",
                "target": "林远",
                "asset_name": "家居服",
                "description": "改穿家居服",
            }
        ]
        resolution = resolve_new_assets(project, items)
        assert resolution.derivatives == [("林远", "家居服", "改穿家居服")]
