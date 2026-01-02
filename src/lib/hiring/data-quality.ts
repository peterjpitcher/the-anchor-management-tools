
export function analyzeDataQuality(candidate: any) {
    const issues: string[] = []
    const parsedData = candidate.parsed_data || {}
    const experience = Array.isArray(parsedData.experience) ? parsedData.experience : []

    // Check for empty resume text
    if (!candidate.resume_text || candidate.resume_text.length < 50) {
        issues.push('Resume text is extremely short or missing.')
    }

    // Check for "Placeholder" patterns in experience
    let emptyDescriptions = 0
    let placeholderDescriptions = 0
    const PLACEHOLDERS = [
        'highlight your accomplishments',
        'using numbers if poss',
        'lorem ipsum',
        'company description',
    ]

    experience.forEach((role: any) => {
        const desc = (role.description || '').toLowerCase().trim()
        if (!desc || desc === 'null') {
            emptyDescriptions++
        } else if (PLACEHOLDERS.some(p => desc.includes(p))) {
            placeholderDescriptions++
        }
    })

    if (emptyDescriptions > 0) {
        issues.push(`Resume contains ${emptyDescriptions} role(s) with no description.`)
    }
    if (placeholderDescriptions > 0) {
        issues.push(`Resume contains ${placeholderDescriptions} role(s) using placeholder text.`)
    }

    return issues
}
