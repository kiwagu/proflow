import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export type AuthEmailActionProps = {
  previewText: string;
  title: string;
  lead: string;
  ctaLabel: string;
  confirmUrl: string;
  footer: string;
};

export function AuthEmailAction({
  previewText,
  title,
  lead,
  ctaLabel,
  confirmUrl,
  footer,
}: AuthEmailActionProps) {
  return (
    <Html lang="und">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{title}</Heading>
          <Text style={text}>{lead}</Text>
          <Section style={btnSection}>
            <Button href={confirmUrl} style={button}>
              {ctaLabel}
            </Button>
          </Section>
          <Text style={footerText}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '560px',
};

const h1 = {
  color: '#1a1a1a',
  fontSize: '24px',
  fontWeight: '600' as const,
  lineHeight: '1.25',
  margin: '40px 0 16px',
  padding: '0 40px',
};

const text = {
  color: '#444',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 16px',
  padding: '0 40px',
};

const btnSection = {
  padding: '0 40px',
  margin: '24px 0',
};

const button = {
  backgroundColor: '#2563eb',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: '600' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  padding: '12px 20px',
};

const footerText = {
  color: '#6b7280',
  fontSize: '14px',
  lineHeight: '20px',
  margin: '32px 0 0',
  padding: '0 40px',
};
