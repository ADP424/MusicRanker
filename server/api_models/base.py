from pydantic import BaseModel, ConfigDict, Field


class ORMSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PositionBody(BaseModel):
    position: int = Field(ge=1)


class LinkBody(BaseModel):
    position: int | None = Field(default=None, ge=1)
