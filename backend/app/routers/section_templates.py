from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models.section_template import SectionTemplate
from app.models.user import User
from app.schemas.section_template import SectionTemplateCreate, SectionTemplateOut

router = APIRouter()


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_section_template(
    body: SectionTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tmpl = SectionTemplate(
        user_id=current_user.id,
        name=body.name,
        cuts_ratio=body.cuts_ratio,
        labels=body.labels,
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return {"data": SectionTemplateOut.model_validate(tmpl)}


@router.get("", response_model=dict)
def list_section_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    templates = (
        db.query(SectionTemplate)
        .filter(SectionTemplate.user_id == current_user.id)
        .order_by(SectionTemplate.created_at.desc())
        .all()
    )
    return {"data": [SectionTemplateOut.model_validate(t) for t in templates]}


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tmpl = (
        db.query(SectionTemplate)
        .filter(SectionTemplate.id == template_id, SectionTemplate.user_id == current_user.id)
        .first()
    )
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(tmpl)
    db.commit()
