# AWS resources for the ledger's event stream. Everything here sits inside the AWS
# always-free tier (SQS: 1M requests/month; IAM and the first two budgets are free).
#
#   terraform init && terraform apply -var alert_email=you@example.com
#   terraform output -raw publisher_secret_access_key   # paste into Render, then forget it
#
# State is local and gitignored because it contains the access key.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { project = "p2p-ledger" }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "alert_email" {
  type        = string
  description = "Where to send the $1 budget alert."
}

# FIFO: per-transfer ordering (message group = transfer id) and broker-side de-duplication
# of relay redeliveries (deduplication id = event id).
resource "aws_sqs_queue" "events_dlq" {
  name                      = "ledger-events-dlq.fifo"
  fifo_queue                = true
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "events" {
  name                      = "ledger-events.fifo"
  fifo_queue                = true
  message_retention_seconds = 345600 # 4 days
  sqs_managed_sse_enabled   = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.events_dlq.arn
    maxReceiveCount     = 5
  })
}

# Least privilege: the service can only send to this one queue.
resource "aws_iam_user" "publisher" {
  name = "ledger-events-publisher"
}

resource "aws_iam_user_policy" "publisher" {
  name = "send-ledger-events"
  user = aws_iam_user.publisher.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = aws_sqs_queue.events.arn
    }]
  })
}

resource "aws_iam_access_key" "publisher" {
  user = aws_iam_user.publisher.name
}

# Guard rail: email if anything in the account starts costing money.
resource "aws_budgets_budget" "guard" {
  name         = "p2p-ledger-guard"
  budget_type  = "COST"
  limit_amount = "1"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 1
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

output "queue_url" {
  value = aws_sqs_queue.events.url
}

output "publisher_access_key_id" {
  value = aws_iam_access_key.publisher.id
}

output "publisher_secret_access_key" {
  value     = aws_iam_access_key.publisher.secret
  sensitive = true
}
