import { UnsubscribeLink } from "./email-template";
import { EmailTemplate, UnsubscribeLinkProps, WorkspaceEmailProps } from "./types";
import { Body, Button, Container, Html, Preview, Section, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";

dayjs.extend(utc);

export type ThrottlingStartedEmailProps = {
  throttled?: number;
} & WorkspaceEmailProps &
  UnsubscribeLinkProps;

const ThrottlingStartedEmail: EmailTemplate<ThrottlingStartedEmailProps> = props => {
  const { name, workspaceSlug, throttled, unsubscribeLink } = props;
  return (
    <Html>
      <Preview>[Action Required] Throttling of Your Jitsu Workspace Events Has Started</Preview>
      <Body style={main}>
        <Container>
          <Section style={{ textAlign: "center", margin: "20px 0" }}>
            <Text style={{ fontSize: "20px", fontWeight: "bold", color: "#333" }}>
              🚨 We started throttling events coming into your{" "}
              <a
                style={{ fontWeight: "bold", color: "#0070f3", textDecoration: "none" }}
                href={`https://use.jitsu.com/${workspaceSlug}`}
              >
                Jitsu Workspace
              </a>{" "}
              at rate of <b style={{ color: "red" }}>{throttled}%</b>
            </Text>
          </Section>

          <Text>👋 Hi {name || "there"}!</Text>

          <Text>
            You’ve been making the most out of Jitsu, and we’re thrilled to see your progress! We wanted to let you know
            that you’ve{" "}
            <a
              style={{ fontWeight: "bold", color: "#0070f3" }}
              href={`https://use.jitsu.com/${workspaceSlug}/settings/billing`}
            >
              reached 100% of your free event quota
            </a>{" "}
            for this month in your Jitsu Workspace. Unfortunately, we had to start dropping events coming into your
            workspace at a rate of <b style={{ color: "red" }}>{throttled}%</b>.
          </Text>

          <Text>To restore full event flow and avoid further data loss, we recommend upgrading your plan.</Text>

          <Section>
            <Text style={{ fontWeight: "bold", color: "#333" }}>
              Upgrade now to restore full event flow and ensure uninterrupted service.
            </Text>
          </Section>

          <Section style={{ textAlign: "center" }}>
            <Button
              href={`https://use.jitsu.com/${workspaceSlug}/settings/billing`}
              style={{
                backgroundColor: "#0070f3",
                color: "#fff",
                padding: "12px 20px",
                borderRadius: "5px",
                textDecoration: "none",
                fontSize: "16px",
                fontWeight: "bold",
              }}
            >
              Upgrade Now
            </Button>
          </Section>

          <Text style={{ marginTop: "20px" }}>
            Thank you for your continued use of Jitsu! We{"'"}re here to help you manage your data effectively.
          </Text>
          <Text>
            Best Regards,
            <br />
            Jitsu Team
            <br />
            <a href="https://jitsu.com" style={{ color: "#0070f3" }}>
              jitsu.com
            </a>
          </Text>
          {unsubscribeLink && <UnsubscribeLink unsubscribeLink={unsubscribeLink} />}
        </Container>
      </Body>
    </Html>
  );
};

ThrottlingStartedEmail.PreviewProps = {
  name: "John",
  workspaceSlug: "workspace-slug",
  workspaceName: "Workspace Name",
  throttled: 50,
  unsubscribeLink: "https://example.com/unsubscribe",
};

ThrottlingStartedEmail.subject = ({ throttled }) =>
  `🚨[Action Required] Throttling of Your Jitsu Events Has Started at ${throttled}% Rate`;
ThrottlingStartedEmail.from = "Jitsu Support <support@notify.jitsu.com>";
ThrottlingStartedEmail.replyTo = "Jitsu Support <support@jitsu.com>";
ThrottlingStartedEmail.isMarketingEmail = false;
