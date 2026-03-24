import jsPDF from 'jspdf'

// ─── Brand colors ─────────────────────────────────────────────────────────────
const NAVY = [11, 18, 32] as const        // #0B1220  (sidebar brand color)
const GOLD = [180, 140, 60] as const      // warm gold accent
const LIGHT_BLUE = [220, 230, 245] as const
const GRAY = [100, 100, 100] as const
const LIGHT_GRAY = [245, 245, 245] as const
const WHITE = [255, 255, 255] as const
const BLACK = [20, 20, 20] as const
const LINE_COLOR = [180, 180, 180] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setColor(doc: jsPDF, rgb: readonly [number, number, number], type: 'fill' | 'text' | 'draw' = 'fill') {
  const [r, g, b] = rgb
  if (type === 'fill') doc.setFillColor(r, g, b)
  else if (type === 'text') doc.setTextColor(r, g, b)
  else doc.setDrawColor(r, g, b)
}

function drawLine(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, color = LINE_COLOR, width = 0.3) {
  setColor(doc, color, 'draw')
  doc.setLineWidth(width)
  doc.line(x1, y1, x2, y2)
}

function sectionHeader(doc: jsPDF, title: string, y: number, pageWidth: number, margin: number): number {
  const w = pageWidth - margin * 2
  setColor(doc, NAVY, 'fill')
  doc.roundedRect(margin, y, w, 8, 1.5, 1.5, 'F')
  setColor(doc, WHITE, 'text')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(title, margin + 4, y + 5.5)
  setColor(doc, BLACK, 'text')
  doc.setFont('helvetica', 'normal')
  return y + 11
}

function fieldLine(doc: jsPDF, label: string, x: number, y: number, lineWidth: number, fontSize = 8) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  setColor(doc, GRAY, 'text')
  doc.text(label, x, y)
  setColor(doc, LINE_COLOR, 'draw')
  doc.setLineWidth(0.3)
  doc.line(x, y + 1, x + lineWidth, y + 1)
  setColor(doc, BLACK, 'text')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize)
}

function checkboxRow(doc: jsPDF, label: string, options: string[], x: number, y: number): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  setColor(doc, GRAY, 'text')
  doc.text(label, x, y)
  let cx = x + 30
  options.forEach(opt => {
    setColor(doc, LINE_COLOR, 'draw')
    doc.setLineWidth(0.3)
    doc.rect(cx, y - 3.5, 3.5, 3.5)
    setColor(doc, BLACK, 'text')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(opt, cx + 5, y)
    cx += 22
  })
  setColor(doc, BLACK, 'text')
  doc.setFont('helvetica', 'normal')
  return y + 7
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generateEmploymentApplicationPDF(): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PAGE_W = 210
  const PAGE_H = 297
  const M = 14          // margin
  const CONTENT_W = PAGE_W - M * 2
  let y = 0

  // ── LOAD LOGO ──────────────────────────────────────────────────────────────
  let logoDataUrl: string | null = null
  try {
    const res = await fetch('/amp.png')
    const blob = await res.blob()
    logoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    logoDataUrl = null
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HEADER BAND
  // ══════════════════════════════════════════════════════════════════════════
  setColor(doc, NAVY, 'fill')
  doc.rect(0, 0, PAGE_W, 38, 'F')

  // Gold accent strip
  setColor(doc, GOLD, 'fill')
  doc.rect(0, 38, PAGE_W, 1.2, 'F')

  // Logo
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', M, 4, 24, 24)
    } catch {}
  }

  // Hotel name & sub-heading
  setColor(doc, WHITE, 'text')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('AMP LODGE', M + 28, 14)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Property Management', M + 28, 19.5)

  // Contact info block (right side)
  doc.setFontSize(7)
  const contactLines = [
    'Abuakwa DKC Junction, Kumasi-Sunyani Rd, Kumasi, Ghana',
    'Tel: +233 55 500 9697   |   Email: info@amplodge.org',
    'Website: https://amplodge.org'
  ]
  contactLines.forEach((line, i) => {
    doc.text(line, PAGE_W - M, 9 + i * 5, { align: 'right' })
  })

  y = 43

  // ══════════════════════════════════════════════════════════════════════════
  // FORM TITLE
  // ══════════════════════════════════════════════════════════════════════════
  setColor(doc, LIGHT_BLUE, 'fill')
  doc.roundedRect(M, y, CONTENT_W, 12, 2, 2, 'F')
  setColor(doc, NAVY, 'text')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('EMPLOYMENT APPLICATION & APPROVAL FORM', PAGE_W / 2, y + 8, { align: 'center' })
  setColor(doc, BLACK, 'text')

  y += 17

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION A: PERSONAL INFORMATION
  // ══════════════════════════════════════════════════════════════════════════
  y = sectionHeader(doc, 'A.  PERSONAL INFORMATION', y, PAGE_W, M)

  // Row 1 — Full Name (spans full width)
  fieldLine(doc, 'Full Name (Last, First, Middle):', M, y, CONTENT_W)
  y += 9

  // Row 2 — 3-column
  const col3 = (CONTENT_W - 8) / 3
  fieldLine(doc, 'Date of Birth:', M, y, col3)
  fieldLine(doc, 'Gender:', M + col3 + 4, y, col3)
  fieldLine(doc, 'Nationality:', M + (col3 + 4) * 2, y, col3)
  y += 9

  // Row 3
  fieldLine(doc, 'National ID Card Number:', M, y, col3 * 1.5)
  fieldLine(doc, 'ID Type (Ghana Card / Passport / Voter):', M + col3 * 1.5 + 4, y, col3 * 1.5)
  y += 9

  // Row 4
  fieldLine(doc, 'Phone Number (Primary):', M, y, col3)
  fieldLine(doc, 'Phone Number (Secondary):', M + col3 + 4, y, col3)
  fieldLine(doc, 'Email Address:', M + (col3 + 4) * 2, y, col3)
  y += 9

  // Row 5
  fieldLine(doc, 'Home Address:', M, y, CONTENT_W)
  y += 9

  // Row 6
  fieldLine(doc, 'Hometown / City:', M, y, col3 * 1.2)
  fieldLine(doc, 'Region:', M + col3 * 1.2 + 4, y, col3 * 0.9)
  fieldLine(doc, 'Country:', M + col3 * 2.1 + 8, y, col3 * 0.9)
  y += 9

  // Marital Status checkbox
  y = checkboxRow(doc, 'Marital Status:', ['Single', 'Married', 'Divorced', 'Widowed'], M, y)

  // Row 7 — Spouse info
  fieldLine(doc, "Spouse / Partner's Name:", M, y, CONTENT_W / 2 - 2)
  fieldLine(doc, "Spouse / Partner's Contact:", M + CONTENT_W / 2 + 2, y, CONTENT_W / 2 - 2)
  y += 10

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION B: EMERGENCY CONTACT
  // ══════════════════════════════════════════════════════════════════════════
  y = sectionHeader(doc, 'B.  EMERGENCY CONTACT', y, PAGE_W, M)

  fieldLine(doc, 'Emergency Contact Name:', M, y, col3 * 1.4)
  fieldLine(doc, 'Relationship:', M + col3 * 1.4 + 4, y, col3 * 0.8)
  fieldLine(doc, 'Contact Phone:', M + col3 * 2.2 + 8, y, col3 * 0.8)
  y += 10

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION C: POSITION APPLIED FOR
  // ══════════════════════════════════════════════════════════════════════════
  y = sectionHeader(doc, 'C.  POSITION APPLIED FOR', y, PAGE_W, M)

  fieldLine(doc, 'Position / Role Applied For:', M, y, col3 * 1.5)
  fieldLine(doc, 'Department:', M + col3 * 1.5 + 4, y, col3 * 1.5)
  y += 9

  y = checkboxRow(doc, 'Employment Type:', ['Full-time', 'Part-time', 'Contract', 'Seasonal'], M, y)

  fieldLine(doc, 'Preferred Start Date:', M, y, col3)
  fieldLine(doc, 'Expected Salary (GHS):', M + col3 + 4, y, col3)
  fieldLine(doc, 'How did you hear about this vacancy?', M + (col3 + 4) * 2, y, col3)
  y += 10

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION D: EDUCATIONAL BACKGROUND
  // ══════════════════════════════════════════════════════════════════════════
  y = sectionHeader(doc, 'D.  EDUCATIONAL BACKGROUND', y, PAGE_W, M)

  // Table header
  const eTH = ['Institution / School', 'Qualification / Certificate', 'Year Completed', 'Grade / Class']
  const eTW = [65, 60, 35, 22]
  setColor(doc, LIGHT_GRAY, 'fill')
  doc.rect(M, y, CONTENT_W, 6, 'F')
  let ex = M
  eTH.forEach((h, i) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    setColor(doc, NAVY, 'text')
    doc.text(h, ex + 1.5, y + 4)
    ex += eTW[i]
  })
  y += 6

  for (let row = 0; row < 3; row++) {
    ex = M
    eTW.forEach(w => {
      setColor(doc, LINE_COLOR, 'draw')
      doc.setLineWidth(0.25)
      doc.rect(ex, y, w, 6)
      ex += w
    })
    y += 6
  }
  setColor(doc, BLACK, 'text')
  y += 4

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION E: WORK EXPERIENCE (check page space)
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 120) {
    doc.addPage()
    y = 20
  }

  y = sectionHeader(doc, 'E.  WORK EXPERIENCE  (Most recent first)', y, PAGE_W, M)

  const wTH = ['Employer / Company', 'Position Held', 'From', 'To', 'Reason for Leaving']
  const wTW = [52, 42, 20, 20, 48]
  setColor(doc, LIGHT_GRAY, 'fill')
  doc.rect(M, y, CONTENT_W, 6, 'F')
  let wx = M
  wTH.forEach((h, i) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    setColor(doc, NAVY, 'text')
    doc.text(h, wx + 1.5, y + 4)
    wx += wTW[i]
  })
  y += 6

  for (let row = 0; row < 3; row++) {
    wx = M
    wTW.forEach(w => {
      setColor(doc, LINE_COLOR, 'draw')
      doc.setLineWidth(0.25)
      doc.rect(wx, y, w, 7)
      wx += w
    })
    y += 7
  }
  setColor(doc, BLACK, 'text')
  y += 4

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION F: SKILLS & LANGUAGES
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 80) { doc.addPage(); y = 20 }

  y = sectionHeader(doc, 'F.  SKILLS & LANGUAGES', y, PAGE_W, M)

  fieldLine(doc, 'Key Skills (e.g. Customer Service, Housekeeping, Cooking, IT, Driving, etc.):', M, y, CONTENT_W)
  y += 9
  fieldLine(doc, 'Languages Spoken:', M, y, CONTENT_W / 2 - 2)
  fieldLine(doc, 'Computer Skills:', M + CONTENT_W / 2 + 2, y, CONTENT_W / 2 - 2)
  y += 10

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION G: REFERENCES
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 80) { doc.addPage(); y = 20 }

  y = sectionHeader(doc, 'G.  REFERENCES  (Please provide two non-family references)', y, PAGE_W, M)

  const half = CONTENT_W / 2 - 3
  ;[1, 2].forEach(n => {
    const ox = n === 1 ? M : M + half + 6
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    setColor(doc, NAVY, 'text')
    doc.text(`Reference ${n}`, ox, y)
    setColor(doc, BLACK, 'text')
    y += 5
    fieldLine(doc, 'Full Name:', ox, y, half)
    y += 7
    fieldLine(doc, 'Organisation / Company:', ox, y, half)
    y += 7
    fieldLine(doc, 'Relationship to Applicant:', ox, y, half)
    y += 7
    fieldLine(doc, 'Phone:', ox, y, half / 2 - 2)
    fieldLine(doc, 'Email:', ox + half / 2 + 2, y, half / 2 - 2)
    if (n === 1) y -= 26  // reset y for second column
  })
  y += 10

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION H: DECLARATION
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 80) { doc.addPage(); y = 20 }

  y = sectionHeader(doc, 'H.  DECLARATION', y, PAGE_W, M)

  setColor(doc, BLACK, 'text')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  const declText = doc.splitTextToSize(
    'I hereby declare that all the information provided in this application is true, accurate, and complete to the best of my knowledge. I understand that any false statement or omission may disqualify me from employment or result in dismissal if discovered after employment. I authorise AMP Lodge to verify any information provided herein.',
    CONTENT_W
  )
  doc.text(declText, M, y)
  y += declText.length * 4 + 5

  // Signature line
  fieldLine(doc, "Applicant's Signature:", M, y, 70)
  fieldLine(doc, 'Date:', M + 80, y, 40)
  y += 12

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION I: FOR OFFICE USE ONLY
  // ══════════════════════════════════════════════════════════════════════════
  if (y > PAGE_H - 90) { doc.addPage(); y = 20 }

  // Dark separator
  setColor(doc, NAVY, 'fill')
  doc.rect(M, y, CONTENT_W, 0.8, 'F')
  y += 4

  setColor(doc, LIGHT_GRAY, 'fill')
  doc.roundedRect(M, y, CONTENT_W, 7, 1.5, 1.5, 'F')
  setColor(doc, NAVY, 'text')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('FOR OFFICE USE ONLY — APPROVAL SECTION', PAGE_W / 2, y + 4.8, { align: 'center' })
  setColor(doc, BLACK, 'text')
  y += 10

  fieldLine(doc, 'Date Application Received:', M, y, col3)
  fieldLine(doc, 'Reference / File Number:', M + col3 + 4, y, col3)
  fieldLine(doc, 'Received By:', M + (col3 + 4) * 2, y, col3)
  y += 9

  fieldLine(doc, 'Interview Date & Time:', M, y, col3 * 1.3)
  fieldLine(doc, 'Interviewed By:', M + col3 * 1.3 + 4, y, col3 * 1.7)
  y += 9

  // Recommendation box
  y = checkboxRow(doc, 'Recommendation:', ['Highly Recommended', 'Recommended', 'Not Recommended'], M, y)

  fieldLine(doc, 'Comments / Remarks:', M, y, CONTENT_W)
  y += 9
  // extra space for comments
  setColor(doc, LINE_COLOR, 'draw')
  doc.setLineWidth(0.25)
  doc.rect(M, y, CONTENT_W, 12)
  y += 16

  // Approvals row
  const approvalCols = ['HR Manager', 'General Manager', 'Director / Owner']
  const apprW = CONTENT_W / 3 - 3
  approvalCols.forEach((col, i) => {
    const ox = M + i * (apprW + 4.5)
    setColor(doc, LIGHT_GRAY, 'fill')
    doc.rect(ox, y, apprW, 5, 'F')
    setColor(doc, NAVY, 'text')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.text(col, ox + apprW / 2, y + 3.5, { align: 'center' })
    setColor(doc, BLACK, 'text')
    doc.setFont('helvetica', 'normal')
    y += 5
    fieldLine(doc, 'Name:', ox, y, apprW)
    y += 7
    fieldLine(doc, 'Signature:', ox, y, apprW)
    y += 7
    fieldLine(doc, 'Date:', ox, y, apprW / 2)
    if (i < 2) y -= 19  // reset for next column
  })
  y += 10

  // Outcome
  y = checkboxRow(doc, 'Final Decision:', ['Approved — Offer Extended', 'Rejected', 'On Hold / Waitlisted'], M, y)
  fieldLine(doc, 'Commencement Date (if Approved):', M, y, col3 * 1.5)
  y += 10

  // ══════════════════════════════════════════════════════════════════════════
  // FOOTER (every page)
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    // Gold line above footer
    setColor(doc, GOLD, 'draw')
    doc.setLineWidth(0.6)
    doc.line(M, PAGE_H - 14, PAGE_W - M, PAGE_H - 14)
    // Footer text
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    setColor(doc, GRAY, 'text')
    doc.text('AMP Lodge  |  Abuakwa DKC Junction, Kumasi-Sunyani Rd, Kumasi, Ghana  |  +233 55 500 9697  |  info@amplodge.org  |  amplodge.org', PAGE_W / 2, PAGE_H - 9, { align: 'center' })
    doc.text(`Confidential — For Internal Use Only    |    Page ${p} of ${totalPages}`, PAGE_W / 2, PAGE_H - 5, { align: 'center' })
  }

  doc.save('AMP-Lodge-Employment-Application-Form.pdf')
}
