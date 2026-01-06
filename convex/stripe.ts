import { ConvexError, v } from 'convex/values';
import { action } from './_generated/server';
import { api } from './_generated/api';
import stripe from '../lib/stripe';
import ratelimit from '../lib/ratelimit';

export const createCheckoutSession = action({
  args: { courseId: v.id('courses') },
  handler: async (ctx, args): Promise<{ checkoutUrl: string | null }> => {
    const identity = await ctx.auth.getUserIdentity();
    // if user is not authenticated, throw an error
    if (!identity) {
      throw new ConvexError('Unauthorized');
    }

    // get the user
    const user = await ctx.runQuery(api.users.getUserByClerkId, {
      clerkId: identity.subject,
    });

    // if user is not found, throw an error
    if (!user) {
      throw new ConvexError('User not found');
    }

    // rate limit ..
    const rateLimitKey = `checkout-rate-limit:${user._id}`;
    const { success } = await ratelimit.limit(rateLimitKey);
    // if rate limit is exceeded, throw an error
    if (!success) {
      throw new Error(`Rate limit exceeded.`);
    }

    // get the course ..
    const course = await ctx.runQuery(api.courses.getCourseById, {
      courseId: args.courseId,
    });
    // if course is not found, throw an error
    if (!course) {
      throw new ConvexError('Course not found');
    }
    // create the checkout session
    const session = await stripe.checkout.sessions.create({
      customer: user.stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: course.title,
              images: [course.imageUrl],
            },
            unit_amount: Math.round(course.price * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/courses/${args.courseId}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/courses`,

      metadata: {
        courseId: args.courseId,
        userId: user._id,
        courseTitle: course.title,
        courseImageUrl: course.imageUrl,
      },
    });

    // return the checkout url
    return { checkoutUrl: session.url };
  },
});

export const createProPlanCheckoutSession = action({
  args: { planId: v.union(v.literal('month'), v.literal('year')) },
  handler: async (ctx, args): Promise<{ checkoutUrl: string | null }> => {
    const identity = await ctx.auth.getUserIdentity();
    // if user is not authenticated, throw an error
    if (!identity) {
      throw new ConvexError('Not authenticated');
    }
    // get the user
    const user = await ctx.runQuery(api.users.getUserByClerkId, {
      clerkId: identity.subject,
    });
    // if user is not found, throw an error
    if (!user) {
      throw new ConvexError('User not found');
    }

    // // rate limit
    // const rateLimitKey = `pro-plan-rate-limit:${user._id}`;
    // const { success } = await ratelimit.limit(rateLimitKey);
    // // if rate limit is exceeded, throw an error
    // if (!success) {
    // 	throw new Error(`Rate limit exceeded.`);
    // }

    // get the price id
    let priceId;
    if (args.planId === 'month') {
      priceId = process.env.STRIPE_MONTHLY_PRICE_ID;
    } else if (args.planId === 'year') {
      priceId = process.env.STRIPE_YEARLY_PRICE_ID;
    }
    // if price id is not found, throw an error
    if (!priceId) {
      throw new ConvexError('PriceId not provided');
    }
    // create the checkout session
    const session = await stripe.checkout.sessions.create({
      customer: user.stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/pro/success?session_id={CHECKOUT_SESSION_ID}&year=${args.planId === 'year'}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pro`,

      metadata: { userId: user._id, planId: args.planId },
    });
    // return the checkout url
    return { checkoutUrl: session.url };
  },
});
