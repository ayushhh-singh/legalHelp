import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The shadcn primitive, on the new tokens. For anything with the file tab or a
 * standard header, prefer @/components/ui-x/{SectionCard,InfoCard,StatCard}.
 */
function Card({ className, ...props }: React.ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentPropsWithRef<"div">) {
  return <div className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentPropsWithRef<"div">) {
  return (
    <div className={cn("font-heading text-base font-semibold", className)} {...props} />
  )
}

function CardDescription({ className, ...props }: React.ComponentPropsWithRef<"div">) {
  return <div className={cn("text-sm text-muted-foreground", className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentPropsWithRef<"div">) {
  return <div className={cn("p-5 pt-0", className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentPropsWithRef<"div">) {
  return <div className={cn("flex items-center p-5 pt-0", className)} {...props} />
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
