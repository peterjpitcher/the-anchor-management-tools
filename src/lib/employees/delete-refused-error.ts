/**
 * Thrown by EmployeeService.deleteEmployee when it refuses a delete before changing anything:
 * today, the training records pre-check (build contract 5.7), both when records exist and when
 * the check itself could not run. The message is written for the manager, so the deleteEmployee
 * action shows it as it is. Any other failure in a delete keeps the action's generic message.
 */
export class EmployeeDeleteRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmployeeDeleteRefusedError'
  }
}
