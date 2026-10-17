import { connection } from 'next/server';

/**
 * The time this request is being handled. With Cache Components, reading the clock needs an
 * explicit request boundary first, otherwise Next tries to prerender it.
 */
export async function requestTime(): Promise<Date> {
  await connection();
  return new Date();
}
