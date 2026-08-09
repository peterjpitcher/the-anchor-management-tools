import { redirect } from 'next/navigation'

// Weekly review is the landing tab: it is the screen managers actually open
// Checklists for. Setup lives at /checklists/manage/setup.
export default function ChecklistsManageIndexPage() {
  redirect('/checklists/manage/review')
}
