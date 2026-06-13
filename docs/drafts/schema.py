from math import atan

from pydantic import BaseModel

class AddMemory(BaseModel):
    memory_id: str ( created by code)
    type: Literal["fact", "decision", "preference"] required
    title: "First 50 characts of the memory" required
    confidence: float(0 to 1) default = 0.6 optional
    tags
    created at ( created by code)
    updated at ( created by code)
