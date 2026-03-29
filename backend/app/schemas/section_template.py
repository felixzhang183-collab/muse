from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class SectionTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    cuts_ratio: list[float] = Field(..., description="Cut positions as 0.0–1.0 ratios of song duration")
    labels: list[str] = Field(..., description="One label per section (len == len(cuts_ratio) + 1)")

    @model_validator(mode="after")
    def validate_structure(self) -> "SectionTemplateCreate":
        if len(self.labels) != len(self.cuts_ratio) + 1:
            raise ValueError("labels must have exactly len(cuts_ratio)+1 entries")
        for r in self.cuts_ratio:
            if not (0.0 < r < 1.0):
                raise ValueError("All cuts_ratio values must be strictly between 0.0 and 1.0")
        return self


class SectionTemplateOut(BaseModel):
    id: str
    name: str
    cuts_ratio: list[float]
    labels: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}
