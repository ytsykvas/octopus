/** What `gh pr view` answers about a request's head: its branch, and whether a fork's. */
export function headRef(branch: string, fork = false): string {
  return JSON.stringify({ headRefName: branch, isCrossRepository: fork })
}
