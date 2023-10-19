import { FormInstanceResponseBeta, Source, TestWorkflowRequestBeta } from 'sailpoint-api-client'

export class Email implements TestWorkflowRequestBeta {
    input: object
    constructor(recipients: string[], formName: string, instance: FormInstanceResponseBeta) {
        const subject = formName
        const body = instance.standAloneFormUrl!
        this.input = {
            recipients,
            subject,
            body,
        }
    }
}

export class ErrorEmail implements TestWorkflowRequestBeta {
    input: object
    constructor(source: Source, recipient: string, error: string) {
        const subject = `IdentityNow Identities [${source.name}] error report`
        const body = error
        this.input = {
            recipients: recipient,
            subject,
            body,
        }
    }
}
