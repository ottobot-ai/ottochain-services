/**
 * Billing and Subscription Management System Tests (TDD)
 * 
 * Tests billing infrastructure for cloud agent subscriptions with usage-based pricing.
 * Covers payment processing, tiered plans, usage tracking, customer portal, and trials.
 * 
 * These tests WILL FAIL until the billing system is implemented - that's the point!
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

// ============================================================================
// Types
// ============================================================================

interface Customer {
  id: string;
  email: string;
  name: string;
  stripeCustomerId: string;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  tier: 'basic' | 'pro' | 'enterprise';
  priceMonthly: number;
  priceYearly: number;
  features: string[];
  limits: {
    agentHours: number;
    storageGB: number;
    apiCallsPerMonth: number;
  };
  stripePriceIdMonthly: string;
  stripePriceIdYearly: string;
}

interface Subscription {
  id: string;
  customerId: string;
  planId: string;
  status: 'trial' | 'active' | 'past_due' | 'canceled' | 'unpaid';
  interval: 'monthly' | 'yearly';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialStart?: string;
  trialEnd?: string;
  stripeSubscriptionId: string;
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface Usage {
  id: string;
  customerId: string;
  subscriptionId: string;
  agentId?: string;
  metricType: 'agent_hours' | 'storage_gb' | 'api_calls' | 'compute_units';
  amount: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface UsageSummary {
  customerId: string;
  subscriptionId: string;
  periodStart: string;
  periodEnd: string;
  usage: {
    agentHours: number;
    storageGB: number;
    apiCalls: number;
    computeUnits: number;
  };
  costs: {
    base: number;
    overages: number;
    total: number;
  };
}

interface Invoice {
  id: string;
  customerId: string;
  subscriptionId: string;
  number: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  subtotal: number;
  tax: number;
  total: number;
  dueDate: string;
  paidAt?: string;
  stripeInvoiceId: string;
  lineItems: Array<{
    description: string;
    amount: number;
    quantity?: number;
    unitPrice?: number;
  }>;
  createdAt: string;
}

interface PaymentMethod {
  id: string;
  customerId: string;
  type: 'card' | 'bank_account';
  last4: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  stripePaymentMethodId: string;
  createdAt: string;
}

interface PromoCode {
  id: string;
  code: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  durationInMonths?: number;
  maxRedemptions?: number;
  currentRedemptions: number;
  expiresAt?: string;
  isActive: boolean;
  createdAt: string;
}

// ============================================================================
// Test Data
// ============================================================================

const testCustomer = {
  email: 'test@example.com',
  name: 'Test Customer',
};

const testPlan: Omit<SubscriptionPlan, 'id' | 'stripePriceIdMonthly' | 'stripePriceIdYearly'> = {
  name: 'Pro Plan',
  tier: 'pro' as const,
  priceMonthly: 2900, // $29.00 in cents
  priceYearly: 29000, // $290.00 in cents (2 months free)
  features: ['Unlimited agents', 'Priority support', 'Advanced analytics'],
  limits: {
    agentHours: 1000,
    storageGB: 100,
    apiCallsPerMonth: 100000,
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

async function createTestCustomer() {
  const response = await fetch(`${GATEWAY_URL}/api/billing/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testCustomer),
  });

  if (!response.ok) {
    throw new Error(`Failed to create customer: ${response.status}`);
  }

  return response.json() as Promise<Customer>;
}

async function createTestPlan() {
  const response = await fetch(`${GATEWAY_URL}/api/billing/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testPlan),
  });

  if (!response.ok) {
    throw new Error(`Failed to create plan: ${response.status}`);
  }

  return response.json() as Promise<SubscriptionPlan>;
}

async function cleanup() {
  // Clean up test data
  try {
    await fetch(`${GATEWAY_URL}/api/billing/test/cleanup`, { method: 'DELETE' });
  } catch (error) {
    // Ignore cleanup errors in tests
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Billing and Subscription Management System', () => {
  let testCustomerId: string;
  let testPlanId: string;

  before(async () => {
    // Check if gateway is running
    try {
      const response = await fetch(`${GATEWAY_URL}/health`);
      assert.ok(response.ok, 'Gateway should be healthy');
    } catch (error) {
      throw new Error(`Gateway not available at ${GATEWAY_URL}`);
    }
  });

  beforeEach(async () => {
    await cleanup();
  });

  after(async () => {
    await cleanup();
  });

  describe('Payment Processing Integration', () => {
    it('should integrate with Stripe for payment processing', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/payment/config`);
      assert.strictEqual(response.status, 200, 'Should return payment config');

      const config = await response.json();
      assert.ok(config.stripe, 'Should have Stripe configuration');
      assert.ok(config.stripe.publishableKey, 'Should have Stripe publishable key');
      assert.ok(config.stripe.webhookEndpoint, 'Should have webhook endpoint');
    });

    it('should handle payment method creation', async () => {
      const customer = await createTestCustomer();

      const response = await fetch(`${GATEWAY_URL}/api/billing/customers/${customer.id}/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'card',
          token: 'tok_visa', // Stripe test token
        }),
      });

      assert.strictEqual(response.status, 201, 'Should create payment method');

      const paymentMethod = (await response.json()) as PaymentMethod;
      assert.strictEqual(paymentMethod.customerId, customer.id, 'Should belong to customer');
      assert.strictEqual(paymentMethod.type, 'card', 'Should be card type');
      assert.strictEqual(paymentMethod.last4, '4242', 'Should show last 4 digits');
      assert.strictEqual(paymentMethod.brand, 'visa', 'Should detect card brand');
      assert.ok(paymentMethod.stripePaymentMethodId, 'Should have Stripe ID');
    });

    it('should set default payment method', async () => {
      const customer = await createTestCustomer();
      
      // Create first payment method
      const pm1Response = await fetch(`${GATEWAY_URL}/api/billing/customers/${customer.id}/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'card', token: 'tok_visa' }),
      });
      const pm1 = (await pm1Response.json()) as PaymentMethod;

      // Create second payment method and set as default
      const pm2Response = await fetch(`${GATEWAY_URL}/api/billing/customers/${customer.id}/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'card', token: 'tok_mastercard', setAsDefault: true }),
      });
      const pm2 = (await pm2Response.json()) as PaymentMethod;

      assert.ok(pm2.isDefault, 'Second payment method should be default');

      // Verify first is no longer default
      const pm1Check = await fetch(`${GATEWAY_URL}/api/billing/payment-methods/${pm1.id}`);
      const pm1Updated = (await pm1Check.json()) as PaymentMethod;
      assert.ok(!pm1Updated.isDefault, 'First payment method should not be default');
    });

    it('should handle payment failures gracefully', async () => {
      const customer = await createTestCustomer();

      const response = await fetch(`${GATEWAY_URL}/api/billing/customers/${customer.id}/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'card',
          token: 'tok_chargeDeclined', // Stripe test token for declined payment
        }),
      });

      assert.strictEqual(response.status, 400, 'Should return 400 for declined card');

      const error = await response.json();
      assert.ok(error.message.includes('declined'), 'Should explain payment failure');
    });
  });

  describe('Tiered Subscription Plans', () => {
    beforeEach(async () => {
      const customer = await createTestCustomer();
      testCustomerId = customer.id;

      const plan = await createTestPlan();
      testPlanId = plan.id;
    });

    it('should create subscription plans with tiered pricing', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/plans`);
      assert.strictEqual(response.status, 200, 'Should list plans');

      const plans = (await response.json()) as SubscriptionPlan[];
      const proPlan = plans.find(p => p.name === 'Pro Plan');

      assert.ok(proPlan, 'Should have Pro Plan');
      assert.strictEqual(proPlan.tier, 'pro', 'Should be pro tier');
      assert.strictEqual(proPlan.priceMonthly, 2900, 'Should have monthly price');
      assert.strictEqual(proPlan.priceYearly, 29000, 'Should have yearly price');
      assert.ok(proPlan.features.length > 0, 'Should have features');
      assert.ok(proPlan.limits.agentHours > 0, 'Should have usage limits');
    });

    it('should create subscription with monthly billing', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
        }),
      });

      assert.strictEqual(response.status, 201, 'Should create subscription');

      const subscription = (await response.json()) as Subscription;
      assert.strictEqual(subscription.customerId, testCustomerId, 'Should belong to customer');
      assert.strictEqual(subscription.planId, testPlanId, 'Should use specified plan');
      assert.strictEqual(subscription.interval, 'monthly', 'Should be monthly billing');
      assert.strictEqual(subscription.status, 'trial', 'Should start with trial');
      assert.ok(subscription.stripeSubscriptionId, 'Should have Stripe subscription ID');
    });

    it('should create subscription with yearly billing and discount', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'yearly',
        }),
      });

      assert.strictEqual(response.status, 201, 'Should create yearly subscription');

      const subscription = (await response.json()) as Subscription;
      assert.strictEqual(subscription.interval, 'yearly', 'Should be yearly billing');

      // Yearly should be discounted (10 months price for 12 months)
      const plan = await fetch(`${GATEWAY_URL}/api/billing/plans/${testPlanId}`);
      const planData = (await plan.json()) as SubscriptionPlan;
      const monthlyTotal = planData.priceMonthly * 12;
      const yearlySavings = monthlyTotal - planData.priceYearly;
      assert.ok(yearlySavings > 0, 'Yearly billing should provide savings');
    });

    it('should enforce plan limits', async () => {
      const subscription = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
        }),
      });
      const sub = (await subscription.json()) as Subscription;

      // Try to use more than plan limits
      const usageResponse = await fetch(`${GATEWAY_URL}/api/billing/usage/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: sub.id,
          metricType: 'agent_hours',
          requestedAmount: 2000, // Exceeds 1000 hour limit
        }),
      });

      assert.strictEqual(usageResponse.status, 402, 'Should return payment required for overage');

      const validation = await usageResponse.json();
      assert.ok(validation.withinLimits === false, 'Should indicate over limits');
      assert.ok(validation.overage > 0, 'Should calculate overage amount');
    });
  });

  describe('Usage Tracking and Billing', () => {
    let subscriptionId: string;

    beforeEach(async () => {
      const customer = await createTestCustomer();
      testCustomerId = customer.id;

      const plan = await createTestPlan();
      testPlanId = plan.id;

      const subResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
        }),
      });
      const subscription = (await subResponse.json()) as Subscription;
      subscriptionId = subscription.id;
    });

    it('should track agent usage hours', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          subscriptionId: subscriptionId,
          agentId: 'agent-123',
          metricType: 'agent_hours',
          amount: 5.5,
          metadata: { sessionId: 'session-456', model: 'gpt-4' },
        }),
      });

      assert.strictEqual(response.status, 201, 'Should record usage');

      const usage = (await response.json()) as Usage;
      assert.strictEqual(usage.customerId, testCustomerId, 'Should belong to customer');
      assert.strictEqual(usage.metricType, 'agent_hours', 'Should track agent hours');
      assert.strictEqual(usage.amount, 5.5, 'Should record exact amount');
      assert.ok(usage.metadata?.sessionId, 'Should store metadata');
    });

    it('should track API calls', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          subscriptionId: subscriptionId,
          metricType: 'api_calls',
          amount: 150,
          metadata: { endpoint: '/api/chat/completions', model: 'claude-3' },
        }),
      });

      assert.strictEqual(response.status, 201, 'Should record API usage');

      const usage = (await response.json()) as Usage;
      assert.strictEqual(usage.metricType, 'api_calls', 'Should track API calls');
      assert.strictEqual(usage.amount, 150, 'Should record call count');
    });

    it('should aggregate usage for billing period', async () => {
      // Record multiple usage events
      const usageEvents = [
        { metricType: 'agent_hours', amount: 10 },
        { metricType: 'agent_hours', amount: 15 },
        { metricType: 'api_calls', amount: 1000 },
        { metricType: 'storage_gb', amount: 25 },
      ];

      for (const event of usageEvents) {
        await fetch(`${GATEWAY_URL}/api/billing/usage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: testCustomerId,
            subscriptionId: subscriptionId,
            ...event,
          }),
        });
      }

      const response = await fetch(`${GATEWAY_URL}/api/billing/usage/summary/${subscriptionId}`);
      assert.strictEqual(response.status, 200, 'Should get usage summary');

      const summary = (await response.json()) as UsageSummary;
      assert.strictEqual(summary.usage.agentHours, 25, 'Should sum agent hours');
      assert.strictEqual(summary.usage.apiCalls, 1000, 'Should track API calls');
      assert.strictEqual(summary.usage.storageGB, 25, 'Should track storage');
      assert.ok(summary.costs.base > 0, 'Should calculate base costs');
    });

    it('should calculate overage charges', async () => {
      // Record usage that exceeds plan limits
      await fetch(`${GATEWAY_URL}/api/billing/usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          subscriptionId: subscriptionId,
          metricType: 'agent_hours',
          amount: 1500, // Exceeds 1000 hour limit by 500
        }),
      });

      const response = await fetch(`${GATEWAY_URL}/api/billing/usage/summary/${subscriptionId}`);
      const summary = (await response.json()) as UsageSummary;

      assert.strictEqual(summary.usage.agentHours, 1500, 'Should record actual usage');
      assert.ok(summary.costs.overages > 0, 'Should calculate overage costs');
      assert.ok(summary.costs.total > summary.costs.base, 'Total should include overages');
    });

    it('should generate usage-based invoices', async () => {
      // Record some usage
      await fetch(`${GATEWAY_URL}/api/billing/usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          subscriptionId: subscriptionId,
          metricType: 'agent_hours',
          amount: 800,
        }),
      });

      // Trigger invoice generation (normally done automatically)
      const response = await fetch(`${GATEWAY_URL}/api/billing/invoices/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId }),
      });

      assert.strictEqual(response.status, 201, 'Should generate invoice');

      const invoice = (await response.json()) as Invoice;
      assert.strictEqual(invoice.customerId, testCustomerId, 'Should belong to customer');
      assert.ok(invoice.lineItems.length > 0, 'Should have line items');
      assert.ok(invoice.total > 0, 'Should have total amount');
      assert.ok(invoice.number, 'Should have invoice number');
    });
  });

  describe('Customer Portal for Billing Management', () => {
    beforeEach(async () => {
      const customer = await createTestCustomer();
      testCustomerId = customer.id;

      const plan = await createTestPlan();
      testPlanId = plan.id;
    });

    it('should provide customer dashboard with billing info', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/customers/${testCustomerId}/dashboard`);
      assert.strictEqual(response.status, 200, 'Should return dashboard');

      const dashboard = await response.json();
      assert.ok(dashboard.customer, 'Should include customer info');
      assert.ok(dashboard.subscription || dashboard.subscription === null, 'Should include subscription status');
      assert.ok(dashboard.paymentMethods, 'Should include payment methods');
      assert.ok(dashboard.invoices, 'Should include recent invoices');
      assert.ok(dashboard.usage, 'Should include current usage');
    });

    it('should allow subscription plan changes', async () => {
      // Create initial subscription
      const subResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
        }),
      });
      const subscription = (await subResponse.json()) as Subscription;

      // Create a different plan
      const basicPlan = await fetch(`${GATEWAY_URL}/api/billing/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Basic Plan',
          tier: 'basic',
          priceMonthly: 990,
          priceYearly: 9900,
          features: ['Basic agents', 'Email support'],
          limits: { agentHours: 100, storageGB: 10, apiCallsPerMonth: 10000 },
        }),
      });
      const basicPlanData = (await basicPlan.json()) as SubscriptionPlan;

      // Change subscription plan
      const changeResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions/${subscription.id}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: basicPlanData.id }),
      });

      assert.strictEqual(changeResponse.status, 200, 'Should allow plan change');

      const updatedSub = (await changeResponse.json()) as Subscription;
      assert.strictEqual(updatedSub.planId, basicPlanData.id, 'Should update to new plan');
    });

    it('should allow subscription cancellation', async () => {
      // Create subscription
      const subResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
        }),
      });
      const subscription = (await subResponse.json()) as Subscription;

      // Cancel subscription
      const cancelResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelAtPeriodEnd: true }),
      });

      assert.strictEqual(cancelResponse.status, 200, 'Should allow cancellation');

      const canceledSub = (await cancelResponse.json()) as Subscription;
      assert.ok(canceledSub.canceledAt, 'Should have cancellation date');
      
      // Subscription should remain active until period end
      assert.ok(['active', 'canceled'].includes(canceledSub.status), 'Should handle cancellation properly');
    });

    it('should provide downloadable invoices', async () => {
      // Create subscription and generate invoice
      const subResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
        }),
      });
      const subscription = (await subResponse.json()) as Subscription;

      const invoiceResponse = await fetch(`${GATEWAY_URL}/api/billing/invoices/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId: subscription.id }),
      });
      const invoice = (await invoiceResponse.json()) as Invoice;

      // Download invoice PDF
      const pdfResponse = await fetch(`${GATEWAY_URL}/api/billing/invoices/${invoice.id}/pdf`);
      assert.strictEqual(pdfResponse.status, 200, 'Should return PDF');
      assert.strictEqual(pdfResponse.headers.get('content-type'), 'application/pdf', 'Should be PDF content');

      const pdfBuffer = await pdfResponse.arrayBuffer();
      assert.ok(pdfBuffer.byteLength > 0, 'Should have PDF content');
    });

    it('should update billing information', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/customers/${testCustomerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Customer Name',
          email: 'updated@example.com',
          billingAddress: {
            line1: '123 Main St',
            city: 'Anytown',
            state: 'CA',
            postalCode: '90210',
            country: 'US',
          },
        }),
      });

      assert.strictEqual(response.status, 200, 'Should update customer info');

      const customer = (await response.json()) as Customer;
      assert.strictEqual(customer.name, 'Updated Customer Name', 'Should update name');
      assert.strictEqual(customer.email, 'updated@example.com', 'Should update email');
    });
  });

  describe('Trial Periods and Promotional Pricing', () => {
    beforeEach(async () => {
      const customer = await createTestCustomer();
      testCustomerId = customer.id;

      const plan = await createTestPlan();
      testPlanId = plan.id;
    });

    it('should create subscription with trial period', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
          trialDays: 14,
        }),
      });

      assert.strictEqual(response.status, 201, 'Should create trial subscription');

      const subscription = (await response.json()) as Subscription;
      assert.strictEqual(subscription.status, 'trial', 'Should be in trial status');
      assert.ok(subscription.trialStart, 'Should have trial start date');
      assert.ok(subscription.trialEnd, 'Should have trial end date');

      // Verify trial period is 14 days
      const trialStart = new Date(subscription.trialStart!);
      const trialEnd = new Date(subscription.trialEnd!);
      const daysDiff = Math.ceil((trialEnd.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
      assert.strictEqual(daysDiff, 14, 'Should have 14-day trial');
    });

    it('should handle trial expiration', async () => {
      // Create subscription with very short trial (for testing)
      const subResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
          trialDays: 0, // Expired immediately
        }),
      });
      const subscription = (await subResponse.json()) as Subscription;

      // Simulate trial expiration processing
      const response = await fetch(`${GATEWAY_URL}/api/billing/subscriptions/${subscription.id}/process-trial-end`, {
        method: 'POST',
      });

      assert.strictEqual(response.status, 200, 'Should process trial end');

      const updatedSub = (await response.json()) as Subscription;
      assert.ok(['active', 'past_due'].includes(updatedSub.status), 'Should transition from trial');
    });

    it('should create and apply promo codes', async () => {
      // Create promo code
      const promoResponse = await fetch(`${GATEWAY_URL}/api/billing/promo-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'SAVE20',
          type: 'percentage',
          value: 20, // 20% off
          durationInMonths: 3,
          maxRedemptions: 100,
        }),
      });

      assert.strictEqual(promoResponse.status, 201, 'Should create promo code');

      const promo = (await promoResponse.json()) as PromoCode;
      assert.strictEqual(promo.code, 'SAVE20', 'Should have correct code');
      assert.strictEqual(promo.type, 'percentage', 'Should be percentage discount');
      assert.strictEqual(promo.value, 20, 'Should have 20% discount');

      // Apply promo code to subscription
      const subResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
          promoCode: 'SAVE20',
        }),
      });

      assert.strictEqual(subResponse.status, 201, 'Should create subscription with promo');

      const subscription = (await subResponse.json()) as Subscription;
      
      // Verify discount was applied
      const invoiceResponse = await fetch(`${GATEWAY_URL}/api/billing/invoices/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId: subscription.id }),
      });
      const invoice = await invoiceResponse.json();

      const discountItem = invoice.lineItems.find((item: any) => item.description.includes('discount'));
      assert.ok(discountItem, 'Should have discount line item');
      assert.ok(discountItem.amount < 0, 'Discount should reduce total');
    });

    it('should validate promo code limits', async () => {
      // Create limited promo code
      const promoResponse = await fetch(`${GATEWAY_URL}/api/billing/promo-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'LIMITED',
          type: 'fixed_amount',
          value: 500, // $5.00 off
          maxRedemptions: 1,
        }),
      });
      const promo = (await promoResponse.json()) as PromoCode;

      // Use the promo code once
      await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
          promoCode: 'LIMITED',
        }),
      });

      // Try to use it again (should fail)
      const customer2 = await createTestCustomer();
      const response = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer2.id,
          planId: testPlanId,
          interval: 'monthly',
          promoCode: 'LIMITED',
        }),
      });

      assert.strictEqual(response.status, 400, 'Should reject exceeded promo code');

      const error = await response.json();
      assert.ok(error.message.includes('redemption limit'), 'Should mention redemption limit');
    });

    it('should handle expired promo codes', async () => {
      // Create expired promo code
      const yesterdayISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const promoResponse = await fetch(`${GATEWAY_URL}/api/billing/promo-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'EXPIRED',
          type: 'percentage',
          value: 50,
          expiresAt: yesterdayISO,
        }),
      });

      // Try to use expired promo
      const response = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: testCustomerId,
          planId: testPlanId,
          interval: 'monthly',
          promoCode: 'EXPIRED',
        }),
      });

      assert.strictEqual(response.status, 400, 'Should reject expired promo code');

      const error = await response.json();
      assert.ok(error.message.includes('expired'), 'Should mention expiration');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid customer data', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invalid-email', // Invalid email format
          name: '', // Empty name
        }),
      });

      assert.strictEqual(response.status, 400, 'Should return 400 for invalid data');

      const error = await response.json();
      assert.ok(error.validationErrors, 'Should have validation errors');
      assert.ok(error.validationErrors.email, 'Should validate email');
      assert.ok(error.validationErrors.name, 'Should validate name');
    });

    it('should handle Stripe webhook failures', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/billing/webhooks/stripe`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'stripe-signature': 'invalid-signature',
        },
        body: JSON.stringify({
          type: 'invoice.payment_failed',
          data: { object: { id: 'in_test123' } },
        }),
      });

      assert.strictEqual(response.status, 400, 'Should return 400 for invalid signature');
    });

    it('should handle subscription limits gracefully', async () => {
      const customer = await createTestCustomer();
      const plan = await createTestPlan();

      // Create subscription
      const subResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          planId: plan.id,
          interval: 'monthly',
        }),
      });
      const subscription = (await subResponse.json()) as Subscription;

      // Try to exceed usage limits
      const usageResponse = await fetch(`${GATEWAY_URL}/api/billing/usage/enforce-limits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: subscription.id,
          metricType: 'agent_hours',
          requestedAmount: 2000, // Exceeds plan limit
        }),
      });

      const result = await usageResponse.json();
      assert.ok(result.allowed === false || result.requiresUpgrade === true, 'Should enforce limits');
    });

    it('should handle concurrent subscription modifications', async () => {
      const customer = await createTestCustomer();
      const plan = await createTestPlan();

      // Create subscription
      const subResponse = await fetch(`${GATEWAY_URL}/api/billing/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          planId: plan.id,
          interval: 'monthly',
        }),
      });
      const subscription = (await subResponse.json()) as Subscription;

      // Simulate concurrent modifications
      const promise1 = fetch(`${GATEWAY_URL}/api/billing/subscriptions/${subscription.id}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id }),
      });

      const promise2 = fetch(`${GATEWAY_URL}/api/billing/subscriptions/${subscription.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelAtPeriodEnd: true }),
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // At least one should succeed, one might fail due to concurrency
      const success = result1.ok || result2.ok;
      assert.ok(success, 'At least one concurrent operation should succeed');
    });
  });
});

// Run info if executed directly
if (process.argv[1] === import.meta.filename) {
  console.log('\n💳 Running Billing and Subscription Management Tests (TDD)\n');
  console.log(`Gateway: ${GATEWAY_URL}\n`);
  console.log('⚠️  These tests WILL FAIL until billing system is implemented!');
  console.log('📝 This is Test-Driven Development - write failing tests first.\n');
}