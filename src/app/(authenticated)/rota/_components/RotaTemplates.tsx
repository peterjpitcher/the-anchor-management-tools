'use client'

import { Card, CardBody } from '@/ds'
import { Button, Badge, Dropdown, DropdownItem, Empty } from '@/ds'
import type { RotaTemplate } from './RotaClient'

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface RotaTemplatesProps {
  templates: RotaTemplate[]
}

export function RotaTemplates({ templates }: RotaTemplatesProps) {
  if (templates.length === 0) {
    return (
      <Card>
        <CardBody>
          <Empty title="No templates" description="Create a rota template to quickly fill in shifts." />
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {templates.map((template) => (
        <Card key={template.id}>
          <CardBody className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-sm font-bold text-text-strong">{template.name}</h4>
                <p className="text-xs text-text-muted mt-0.5">{template.description}</p>
              </div>
              <Dropdown trigger={<button type="button" className="text-xs text-text-muted hover:text-text">...</button>}>
                <DropdownItem onClick={() => {}}>Edit</DropdownItem>
                <DropdownItem onClick={() => {}}>Duplicate</DropdownItem>
                <DropdownItem onClick={() => {}}>Delete</DropdownItem>
              </Dropdown>
            </div>

            <div className="flex items-center gap-2">
              <Badge tone="neutral">{template.shiftCount} shifts</Badge>
            </div>

            <Button variant="secondary" size="sm" className="w-full">Load Template</Button>
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
