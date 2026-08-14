/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { circleDeveloperSdk } from "@/lib/utils/developer-controlled-wallets-client";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";

const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const USDC_DECIMALS = 6;

const TransferSchema = z.object({
  destinationAddress: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid destination address")
    .refine(
      (address) => address.toLowerCase() !== ZERO_ADDRESS,
      "Destination address cannot be the zero address",
    ),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,6})?$/, "Amount must have at most 6 decimal places")
    .refine((value) => toUsdcUnits(value) > 0n, "Amount must be greater than zero"),
});

function toUsdcUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = fraction.padEnd(USDC_DECIMALS, "0");
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(paddedFraction || "0");
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = TransferSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const { data: wallet, error: walletError } = await supabase
      .from("wallets")
      .select("circle_wallet_id")
      .eq("profile_id", profile.id)
      .single();

    if (walletError || !wallet?.circle_wallet_id) {
      return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    }

    const balanceResponse = await circleDeveloperSdk.getWalletTokenBalance({
      id: wallet.circle_wallet_id,
      includeAll: true,
    });

    const usdcBalance = balanceResponse.data?.tokenBalances?.find(
      ({ token }) => token.symbol === "USDC",
    );

    const available = toUsdcUnits(usdcBalance?.amount ?? "0");
    const requested = toUsdcUnits(parsed.data.amount);

    if (requested > available) {
      return NextResponse.json(
        { error: "Insufficient USDC balance" },
        { status: 400 },
      );
    }

    const response = await circleDeveloperSdk.createTransaction({
      amounts: [parsed.data.amount],
      destinationAddress: parsed.data.destinationAddress,
      tokenAddress: ARC_TESTNET_USDC,
      blockchain: "ARC-TESTNET",
      walletId: wallet.circle_wallet_id,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });

    const transaction = response.data;
    if (!transaction?.id) {
      throw new Error("Circle did not return a transaction id");
    }

    return NextResponse.json(
      {
        transactionId: transaction.id,
        state: transaction.state,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error transferring USDC:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to transfer USDC" },
      { status: 500 },
    );
  }
}
