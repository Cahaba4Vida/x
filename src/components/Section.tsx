import { PropsWithChildren, ReactNode } from 'react';

export function Section(props: PropsWithChildren<{ title: string; actions?: ReactNode }>) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{props.title}</h2>
        {props.actions ? <div>{props.actions}</div> : null}
      </div>
      {props.children}
    </section>
  );
}
