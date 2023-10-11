import { TestWorkflowRequestBeta } from 'sailpoint-api-client'

export class ErrorEmail implements TestWorkflowRequestBeta {
    input: object
    constructor(error: string, identityId: string) {
        const subject = `IdentityNow Management error report`
        const body = error
        this.input = {
            recipients: [identityId],
            subject,
            body,
        }
    }
}
