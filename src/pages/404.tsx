import React from 'react'
import Layout from '../components/layout'
import Head from '../components/head'
import {graphql} from 'gatsby'

interface Props {
  readonly data: PageQueryData
}

export default class NotFoundPage extends React.Component<Props> {
  render() {
    const {data} = this.props
    const siteTitle = data.site.siteMetadata.title

    return (
      <Layout title={siteTitle}>
        <Head title={`404: Not found`} />
        <h1>Not found</h1>
        <p>
          ...and that's a <strong>bad</strong> miss!
        </p>
      </Layout>
    )
  }
}

interface PageQueryData {
  site: {
    siteMetadata: {
      title: string
    }
  }
}

export const pageQuery = graphql`
  query {
    site {
      siteMetadata {
        title
      }
    }
  }
`
