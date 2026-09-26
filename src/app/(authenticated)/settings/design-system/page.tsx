'use client'

import { Card, CardBody, PageLayout, Section, SubHeading } from '@/ds'

import { AnatomySection } from './_components/AnatomySection'
import { ButtonsSection, FiguresSection, FormsSection, LayoutSection, StatusSection } from './_components/ComponentSections'
import { ChartsSection, NavigationSection, OverlaysSection, TablesSection } from './_components/DataSections'
import {
  ColoursSection,
  IconsSection,
  RulesSection,
  ShapeSection,
  SizesSection,
  TypeSection,
} from './_components/FoundationSections'
import { GuestReferenceSection } from './_components/GuestReferenceSection'
import { TokenValuesProvider } from './_components/reference-ui'

/** Every block on the page, in order, for the contents card. Each id is a Section id. */
const CONTENTS: ReadonlyArray<{ group: string; links: ReadonlyArray<{ id: string; label: string }> }> = [
  {
    group: 'Foundations',
    links: [
      { id: 'rules', label: 'Rules' },
      { id: 'colours', label: 'Colours' },
      { id: 'type', label: 'Type' },
      { id: 'shape', label: 'Radius and Shadows' },
      { id: 'sizes', label: 'Sizes and Spacing' },
      { id: 'icons', label: 'Icons' },
    ],
  },
  {
    group: 'Components',
    links: [
      { id: 'anatomy', label: 'Page Anatomy' },
      { id: 'buttons', label: 'Buttons and Links' },
      { id: 'forms', label: 'Forms' },
      { id: 'status', label: 'Status and Feedback' },
      { id: 'figures', label: 'Figures' },
      { id: 'layout', label: 'Cards and Content' },
      { id: 'tables', label: 'Tables' },
      { id: 'navigation', label: 'Tabs and Views' },
      { id: 'overlays', label: 'Overlays' },
      { id: 'charts', label: 'Charts' },
    ],
  },
  {
    group: 'Guest',
    links: [{ id: 'guest', label: 'Guest Pages' }],
  },
]

/**
 * The live reference for the design system: every token, read from the app stylesheet, and every
 * component exported from @/ds with a working example. A client component: the examples keep
 * state and the token values are read from the browser.
 */
export default function DesignSystemPage(): React.JSX.Element {
  return (
    <PageLayout
      title="Design System"
      subtitle="Tokens and components, read live from the app stylesheet"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <TokenValuesProvider>
        <Section
          title="On This Page"
          description="The rules behind it are in docs/standards/UI_UX.md; the guards in tests/guards enforce them"
        >
          <Card>
            <CardBody>
              <nav aria-label="Design system contents" className="grid gap-4 sm:grid-cols-3">
                {CONTENTS.map(({ group, links }) => (
                  <div key={group} className="space-y-1.5">
                    {/* A card with no CardHeader, so the group headings are h3. */}
                    <SubHeading as="h3">{group}</SubHeading>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {links.map((link) => (
                        <li key={link.id}>
                          <a
                            href={`#${link.id}`}
                            className="rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-hidden focus-visible:shadow-ring"
                          >
                            {link.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
            </CardBody>
          </Card>
        </Section>

        <RulesSection />
        <ColoursSection />
        <TypeSection />
        <ShapeSection />
        <SizesSection />
        <IconsSection />
        <AnatomySection />
        <ButtonsSection />
        <FormsSection />
        <StatusSection />
        <FiguresSection />
        <LayoutSection />
        <TablesSection />
        <NavigationSection />
        <OverlaysSection />
        <ChartsSection />
        <GuestReferenceSection />
      </TokenValuesProvider>
    </PageLayout>
  )
}
